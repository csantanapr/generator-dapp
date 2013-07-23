require({cache:{
'dojox/app/main':function(){
define(["require", "dojo/_base/kernel", "dojo/_base/lang", "dojo/_base/declare", "dojo/_base/config",
	"dojo/_base/window", "dojo/Evented", "dojo/Deferred", "dojo/when", "dojo/has", "dojo/on", "dojo/ready",
	"dojo/dom-construct", "dojo/dom-attr", "./utils/model", "./utils/nls", "./module/lifecycle",
	"./utils/hash", "./utils/constraints", "./utils/config"],
	function(require, kernel, lang, declare, config, win, Evented, Deferred, when, has, on, ready, domConstruct, domAttr,
		 model, nls, lifecycle, hash, constraints, configUtils){

	has.add("app-log-api", (config["app"] || {}).debugApp);

	var Application = declare(Evented, {
		constructor: function(params, node){
			lang.mixin(this, params);
			this.params = params;
			this.id = params.id;
			this.defaultView = params.defaultView;
			this.controllers = [];
			this.children = {};
			this.loadedModels = {};
			this.loadedStores = {};
			// Create a new domNode and append to body
			// Need to bind startTransition event on application domNode,
			// Because dojox/mobile/ViewController bind startTransition event on document.body
			// Make application's root domNode id unique because this id can be visited by window namespace on Chrome 18.
			this.setDomNode(domConstruct.create("div", {
				id: this.id+"_Root",
				style: "width:100%; height:100%; overflow-y:hidden; overflow-x:hidden;"
			}));
			node.appendChild(this.domNode);
		},

		createDataStore: function(params){
			// summary:
			//		Create data store instance
			//
			// params: Object
			//		data stores configuration.

			if(params.stores){
				//create stores in the configuration.
				for(var item in params.stores){
					if(item.charAt(0) !== "_"){//skip the private properties
						var type = params.stores[item].type ? params.stores[item].type : "dojo/store/Memory";
						var config = {};
						if(params.stores[item].params){
							lang.mixin(config, params.stores[item].params);
						}
						// we assume the store is here through dependencies
						try{
							var storeCtor = require(type);
						}catch(e){
							throw new Error(type+" must be listed in the dependencies");
						}
						if(config.data && lang.isString(config.data)){
							//get the object specified by string value of data property
							//cannot assign object literal or reference to data property
							//because json.ref will generate __parent to point to its parent
							//and will cause infinitive loop when creating StatefulModel.
							config.data = lang.getObject(config.data);
						}
						if(params.stores[item].observable){
							try{
								var observableCtor = require("dojo/store/Observable");
							}catch(e){
								throw new Error("dojo/store/Observable must be listed in the dependencies");
							}
							params.stores[item].store = observableCtor(new storeCtor(config));
						}else{
							params.stores[item].store = new storeCtor(config);
						}
						this.loadedStores[item] = params.stores[item].store;							
					}
				}
			}
		},

		createControllers: function(controllers){
			// summary:
			//		Create controller instance
			//
			// controllers: Array
			//		controller configuration array.
			// returns:
			//		controllerDeferred object

			if(controllers){
				var requireItems = [];
				for(var i = 0; i < controllers.length; i++){
					requireItems.push(controllers[i]);
				}

				var def = new Deferred();
				var requireSignal;
				try{
					requireSignal = require.on("error", function(error){
						if(def.isResolved() || def.isRejected()){
							return;
						}
						def.reject("load controllers error.");
						requireSignal.remove();
					});
					require(requireItems, function(){
						def.resolve.call(def, arguments);
						requireSignal.remove();
					});
				}catch(e){
					def.reject(e);
					if(requireSignal){
						requireSignal.remove();
					}
				}

				var controllerDef = new Deferred();
				when(def, lang.hitch(this, function(){
					for(var i = 0; i < arguments[0].length; i++){
						// instantiate controllers, set Application object, and perform auto binding
						this.controllers.push((new arguments[0][i](this)).bind());
					}
					controllerDef.resolve(this);
				}), function(){
					//require def error, reject loadChildDeferred
					controllerDef.reject("load controllers error.");
				});
				return controllerDef;
			}
		},

		trigger: function(event, params){
			// summary:
			//		trigger an event. Deprecated, use emit instead.
			//
			// event: String
			//		event name. The event is binded by controller.bind() method.
			// params: Object
			//		event params.
			kernel.deprecated("dojox.app.Application.trigger", "Use dojox.app.Application.emit instead", "2.0");
			this.emit(event, params);
		},

		// setup default view and Controllers and startup the default view
		start: function(){
			//
			//create application level data store
			this.createDataStore(this.params);

			// create application level data model
			var loadModelLoaderDeferred = new Deferred();
			var createPromise;
			try{
				createPromise = model(this.params.models, this, this);
			}catch(e){
				loadModelLoaderDeferred.reject(e);
				return loadModelLoaderDeferred.promise;
			}
			when(createPromise, lang.hitch(this, function(models){
				// if models is an array it comes from dojo/promise/all. Each array slot contains the same result object
				// so pick slot 0.
				this.loadedModels = lang.isArray(models)?models[0]:models;
				this.setupControllers();
				// if available load root NLS
				when(nls(this.params), lang.hitch(this, function(nls){
					if(nls){
						lang.mixin(this.nls = {}, nls);
					}
					this.startup();
				}));
			}), function(){
				loadModelLoaderDeferred.reject("load model error.")
			});
		},

		setDomNode: function(domNode){
			var oldNode = this.domNode;
			this.domNode = domNode;
			this.emit("app-domNode", {
				oldNode: oldNode,
				newNode: domNode
			});
		},

		setupControllers: function(){
			// create application controller instance
			// move set _startView operation from history module to application
			var currentHash = window.location.hash;
		//	this._startView = (((currentHash && currentHash.charAt(0) == "#") ? currentHash.substr(1) : currentHash) || this.defaultView).split('&')[0];
			this._startView = hash.getTarget(currentHash, this.defaultView);
			this._startParams = hash.getParams(currentHash);
		},

		startup: function(){
			// load controllers and views
			//
			this.selectedChildren = {};			
			var controllers = this.createControllers(this.params.controllers);
			// constraint on app
			if(this.hasOwnProperty("constraint")){
				constraints.register(this.params.constraints);
			}else{
				this.constraint = "center";
			}
			var emitLoad = function(){
				// emit "app-load" event and let controller to load view.
				this.emit("app-load", {
					viewId: this.defaultView,
					params: this._startParams,
					callback: lang.hitch(this, function (){
						var parts = this.defaultView.split('+'), selectId, constraint;
						// TODO all this code should be moved to a controller, there is no reason to do that here
						// for initial view and somewhere else for the rest
						if(parts.length > 0){		
							while(parts.length > 0){ 	
								var viewId = parts.shift();
								selectId = viewId.split(",").shift();
								// set the constraint
								if(!this.children[this.id + "_" + selectId].hasOwnProperty("constraint")){
									this.children[this.id + '_' + selectId].constraint = domAttr.get(this.children[this.id + '_' + selectId].domNode, "data-app-constraint") || "center";
								}
								constraints.register(constraint = this.children[this.id + '_' + selectId].constraint);
								constraints.setSelectedChild(this, constraint, this.children[this.id + '_' + selectId]);
							}
						}else{
							var selectId = this.defaultView.split(",").shift();
							// set the constraint
							if(!this.children[this.id + "_" + selectId].hasOwnProperty("constraint")){
								this.children[this.id + '_' + selectId].constraint = domAttr.get(this.children[this.id + '_' + selectId].domNode, "data-app-constraint") || "center";
							}
							constraints.register(constraint = this.children[this.id + '_' + selectId].constraint);
							constraints.setSelectedChild(this, constraint, this.children[this.id + '_' + selectId]);
						}
						// transition to startView. If startView==defaultView, that means initial the default view.
						this.emit("app-transition", {
							viewId: this._startView,
							opts: { params: this._startParams }
						});
						this.setStatus(this.lifecycle.STARTED);
					})
				});
			};
			when(controllers, lang.hitch(this, function(){
				if(this.template){
					// emit "app-init" event so that the Load controller can initialize root view
					this.emit("app-init", {
						app: this,	// pass the app into the View so it can have easy access to app
						name: this.name,
						type: this.type,
						parent: this,
						templateString: this.templateString,
						controller: this.controller,
						callback: lang.hitch(this, function(view){
							this.setDomNode(view.domNode);
							emitLoad.call(this);
						})
					});
				}else{
					emitLoad.call(this);
				}
			}));
		}		
	});

	function generateApp(config, node){
		// summary:
		//		generate the application
		//
		// config: Object
		//		app config
		// node: domNode
		//		domNode.
		var path;

		// call configProcessHas to process any has blocks in the config
		config = configUtils.configProcessHas(config);

		if(!config.loaderConfig){
			config.loaderConfig = {};
		}
		if(!config.loaderConfig.paths){
			config.loaderConfig.paths = {};
		}
		if(!config.loaderConfig.paths["app"]){
			// Register application module path
			path = window.location.pathname;
			if(path.charAt(path.length) != "/"){
				path = path.split("/");
				path.pop();
				path = path.join("/");
			}
			config.loaderConfig.paths["app"] = path;
		}
		require(config.loaderConfig);

		if(!config.modules){
			config.modules = [];
		}
		// add dojox/app lifecycle module by default
		config.modules.push("./module/lifecycle");
		var modules = config.modules.concat(config.dependencies?config.dependencies:[]);

		if(config.template){
			path = config.template;
			if(path.indexOf("./") == 0){
				path = "app/"+path;
			}
			modules.push("dojo/text!" + path);
		}

		require(modules, function(){
			var modules = [Application];
			for(var i = 0; i < config.modules.length; i++){
				modules.push(arguments[i]);
			}

			if(config.template){
				var ext = {
					templateString: arguments[arguments.length - 1]
				}
			}
			App = declare(modules, ext);

			ready(function(){
				var app = new App(config, node || win.body());

				if(has("app-log-api")){
					app.log = function(){
						// summary:
						//		If config is set to turn on app logging, then log msg to the console
						//
						// arguments: 
						//		the message to be logged, 
						//		all but the last argument will be treated as Strings and be concatenated together, 
						//      the last argument can be an object it will be added as an argument to the console.log 						
						var msg = "";
						try{
							for(var i = 0; i < arguments.length-1; i++){
								msg = msg + arguments[i];
							}
							console.log(msg,arguments[arguments.length-1]);
						}catch(e){}
					};
				}else{
					app.log = function(){}; // noop
				}

				app.transitionToView = function(/*DomNode*/target, /*Object*/transitionOptions, /*Event?*/triggerEvent){
					// summary:
					//		A convenience function to fire the transition event to transition to the view.
					//
					// target:
					//		The DOM node that initiates the transition (for example a ListItem).
					// transitionOptions:
					//		Contains the transition options.
					// triggerEvent:
					//		The event that triggered the transition (for example a touch event on a ListItem).
					var opts = {bubbles:true, cancelable:true, detail: transitionOptions, triggerEvent: triggerEvent||null};	
					on.emit(target,"startTransition", opts);
				};

				app.setStatus(app.lifecycle.STARTING);
				// Create global namespace for application.
				// The global name is application id. For example: modelApp
				var globalAppName = app.id;
				if(window[globalAppName]){
					lang.mixin(app, window[globalAppName]);
				}
				window[globalAppName] = app;
				app.start();
			});
		});
	}

	return function(config, node){
		if(!config){
			throw new Error("App Config Missing");
		}

		if(config.validate){
			require(["dojox/json/schema", "dojox/json/ref", "dojo/text!dojox/application/schema/application.json"], function(schema, appSchema){
				schema = dojox.json.ref.resolveJson(schema);
				if(schema.validate(config, appSchema)){
					generateApp(config, node);
				}
			});
		}else{
			generateApp(config, node);
		}
	}
});

},
'dojox/app/utils/model':function(){
define(["dojo/_base/lang", "dojo/Deferred", "dojo/promise/all", "dojo/when"], function(lang, Deferred, all, when){
	return function(/*Object*/ config, /*Object*/ parent, /*Object*/ app){
		// summary:
		//		model is called to create all of the models for the app, and all models for a view, it will
		//		create and call the appropriate model utility based upon the modelLoader set in the model in the config
		// description:
		//		Called for each view or for the app.  For each model in the config, it will  
		//		create the model utility based upon the modelLoader and call it to create and load the model. 
		// config: Object
		//		The models section of the config for this view or for the app.
		// parent: Object
		//		The parent of this view or the app itself, so that models from the parent will be 
		//		available to the view.
		// returns: loadedModels 
		//		 loadedModels is an object holding all of the available loaded models for this view.
		var loadedModels = {};
		if(parent.loadedModels){
			lang.mixin(loadedModels, parent.loadedModels);
		}
		if(config){
			var allDeferred = [];
			for(var item in config){
				if(item.charAt(0) !== "_"){
					allDeferred.push(setupModel(config, item, app, loadedModels));
				}
			}
			return (allDeferred.length == 0) ? loadedModels : all(allDeferred);
		}else{
			return loadedModels;
		}
	};

	function setupModel(config, item, app, loadedModels){
		// Here we need to create the modelLoader and call it passing in the item and the config[item].params
		var params = config[item].params ? config[item].params : {};

		var modelLoader = config[item].modelLoader ? config[item].modelLoader : "dojox/app/utils/simpleModel";
		// modelLoader must be listed in the dependencies and has thus already been loaded so it _must_ be here
		// => no need for complex code here
		try{
			var modelCtor = require(modelLoader);
		}catch(e){
			throw new Error(modelLoader+" must be listed in the dependencies");
		}
		var loadModelDeferred = new Deferred();
		var createModelPromise;
		try{
			createModelPromise = modelCtor(config, params, item);
		}catch(e){
			throw new Error("Error creating "+modelLoader+" for model named ["+item+"]: "+e.message);
		}
		when(createModelPromise, lang.hitch(this, function(newModel){
			loadedModels[item] = newModel;
			app.log("in app/model, for item=[",item,"] loadedModels =", loadedModels);
			loadModelDeferred.resolve(loadedModels);
			return loadedModels;
		}), function(e){
			throw new Error("Error loading model named ["+item+"]: "+e.message);
		});
		return loadModelDeferred;
	}
});

},
'dojo/promise/all':function(){
define([
	"../_base/array",
	"../Deferred",
	"../when"
], function(array, Deferred, when){
	"use strict";

	// module:
	//		dojo/promise/all

	var some = array.some;

	return function all(objectOrArray){
		// summary:
		//		Takes multiple promises and returns a new promise that is fulfilled
		//		when all promises have been fulfilled.
		// description:
		//		Takes multiple promises and returns a new promise that is fulfilled
		//		when all promises have been fulfilled. If one of the promises is rejected,
		//		the returned promise is also rejected. Canceling the returned promise will
		//		*not* cancel any passed promises.
		// objectOrArray: Object|Array?
		//		The promise will be fulfilled with a list of results if invoked with an
		//		array, or an object of results when passed an object (using the same
		//		keys). If passed neither an object or array it is resolved with an
		//		undefined value.
		// returns: dojo/promise/Promise

		var object, array;
		if(objectOrArray instanceof Array){
			array = objectOrArray;
		}else if(objectOrArray && typeof objectOrArray === "object"){
			object = objectOrArray;
		}

		var results;
		var keyLookup = [];
		if(object){
			array = [];
			for(var key in object){
				if(Object.hasOwnProperty.call(object, key)){
					keyLookup.push(key);
					array.push(object[key]);
				}
			}
			results = {};
		}else if(array){
			results = [];
		}

		if(!array || !array.length){
			return new Deferred().resolve(results);
		}

		var deferred = new Deferred();
		deferred.promise.always(function(){
			results = keyLookup = null;
		});
		var waiting = array.length;
		some(array, function(valueOrPromise, index){
			if(!object){
				keyLookup.push(index);
			}
			when(valueOrPromise, function(value){
				if(!deferred.isFulfilled()){
					results[keyLookup[index]] = value;
					if(--waiting === 0){
						deferred.resolve(results);
					}
				}
			}, deferred.reject);
			return deferred.isFulfilled();
		});
		return deferred.promise;	// dojo/promise/Promise
	};
});

},
'dojox/app/utils/nls':function(){
define(["require", "dojo/Deferred"],  function(require, Deferred){
	return function(/*Object*/ config, /*Object*/ parent){
		// summary:
		//		nsl is called to create to load the nls all for the app, or for a view.
		// config: Object
		//		The section of the config for this view or for the app.
		// parent: Object
		//		The parent of this view or the app itself, so that models from the parent will be
		//		available to the view.
		var path = config.nls;
		if(path){
			var nlsDef = new Deferred();
			var requireSignal;
			try{
				var loadFile = path;
				var index = loadFile.indexOf("./");
				if(index >= 0){
					loadFile = path.substring(index+2);
				}
				requireSignal = require.on("error", function(error){
					if (nlsDef.isResolved() || nlsDef.isRejected()) {
						return;
					}
					if(error.info[0] && (error.info[0].indexOf(loadFile)>= 0)){
						nlsDef.resolve(false);
						requireSignal.remove();
					}
				});

				if(path.indexOf("./") == 0){
					path = "app/"+path;
				}

				require(["dojo/i18n!"+path], function(nls){
					nlsDef.resolve(nls);
					requireSignal.remove();
				});
			}catch(e){
				nlsDef.reject(e);
				if(requireSignal){
					requireSignal.remove();
				}
			}
			return nlsDef;
		}else{
			return false;
		}
	};
});

},
'dojox/app/module/lifecycle':function(){
define(["dojo/_base/declare", "dojo/topic"], function(declare, topic){
	return declare(null, {

		lifecycle: {
			UNKNOWN: 0, //unknown
			STARTING: 1, //starting
			STARTED: 2, //started
			STOPPING: 3, //stopping
			STOPPED: 4 //stopped
		},

		_status: 0, //unknown

		getStatus: function(){
			return this._status;
		},

		setStatus: function(newStatus){
			this._status = newStatus;

			// publish /app/status event.
			// application can subscribe this event to do some status change operation.
			topic.publish("/app/status", newStatus);
		}
	});
});

},
'dojox/app/utils/hash':function(){
define(["dojo/_base/lang"], function(lang){

// module:
//		dojox/app/utils/hash

var hashUtil = {
	// summary:
	//		This module contains the hash

		getParams: function(/*String*/ hash){
			// summary:
			//		get the params from the hash
			//
			// hash: String
			//		the url hash
			//
			// returns:
			//		the params object
			//
			var params;
			if(hash && hash.length){
				// fixed handle view specific params
				
				while(hash.indexOf("(") > 0){ 
					var index = hash.indexOf("(");
					var endindex = hash.indexOf(")");
					var viewPart = hash.substring(index,endindex+1);
					if(!params){ params = {}; }
					params = hashUtil.getParamObj(params, viewPart);
					// next need to remove the viewPart from the hash, and look for the next one
					var viewName = viewPart.substring(1,viewPart.indexOf("&"));
					hash = hash.replace(viewPart, viewName);
				}	
				// after all of the viewParts need to get the other params	

				for(var parts = hash.split("&"), x = 0; x < parts.length; x++){
					var tp = parts[x].split("="), name = tp[0], value = encodeURIComponent(tp[1] || "");
					if(name && value){
						if(!params){ params = {}; }
						params[name] = value;
					}
				}
			}
			return params; // Object
		},

		getParamObj: function(/*Object*/ params, /*String*/ viewPart){
			// summary:
			//		called to handle a view specific params object
			// params: Object
			//		the view specific params object
			// viewPart: String
			//		the part of the view with the params for the view
			//
			// returns:
	 		//		the params object for the view
			//
			var viewparams;
			var viewName = viewPart.substring(1,viewPart.indexOf("&"));
			var hash = viewPart.substring(viewPart.indexOf("&"), viewPart.length-1);
				for(var parts = hash.split("&"), x = 0; x < parts.length; x++){
					var tp = parts[x].split("="), name = tp[0], value = encodeURIComponent(tp[1] || "");
					if(name && value){
						if(!viewparams){ viewparams = {}; }
						viewparams[name] = value;
					}
				}
			params[viewName] = 	viewparams;
			return params; // Object
		},

		buildWithParams: function(/*String*/ hash, /*Object*/ params){
			// summary:
			//		build up the url hash adding the params
			// hash: String
			//		the url hash
			// params: Object
			//		the params object
			//
			// returns:
	 		//		the params object
			//
			if(hash.charAt(0) !== "#"){
				hash = "#"+hash;
			}
			for(var item in params){
				var value = params[item];
				// add a check to see if the params includes a view name if so setup the hash like (viewName&item=value);
				if(lang.isObject(value)){
					hash = hashUtil.addViewParams(hash, item, value);
				}else{
					if(item && value != null){
						hash = hash+"&"+item+"="+params[item];
					}
				}
			}
			return hash; // String
		},

		addViewParams: function(/*String*/ hash, /*String*/ view, /*Object*/ params){
			// summary:
			//		add the view specific params to the hash for example (view1&param1=value1)
			// hash: String
			//		the url hash
			// view: String
			//		the view name
			// params: Object
			//		the params for this view
			//
			// returns:
			//		the hash string
			//
			if(hash.charAt(0) !== "#"){
				hash = "#"+hash;
			}
			var index = hash.indexOf(view);
			if(index > 0){ // found the view?
				if((hash.charAt(index-1) == "#" || hash.charAt(index-1) == "+") && // assume it is the view? or could check the char after for + or & or -
					(hash.charAt(index+view.length) == "&" || hash.charAt(index+view.length) == "+" || hash.charAt(index+view.length) == "-")){
					// found the view at this index.
					var oldView = hash.substring(index-1,index+view.length+1);
					var paramString = hashUtil.getParamString(params);
					var newView = hash.charAt(index-1) + "(" + view + paramString + ")" + hash.charAt(index+view.length);
					hash = hash.replace(oldView, newView);
				}
			}
			
			return hash; // String
		},

		getParamString: function(/*Object*/ params){
			// summary:
			//		return the param string
			// params: Object
			//		the params object
			//
			// returns:
			//		the params string
			//
			var paramStr = "";
			for(var item in params){
				var value = params[item];
				if(item && value != null){
					paramStr = paramStr+"&"+item+"="+params[item];
				}
			}
			return paramStr; // String
		},

		getTarget: function(/*String*/ hash, /*String?*/ defaultView){
			// summary:
			//		return the target string
			// hash: String
			//		the hash string
			// defaultView: String
			//		the optional defaultView string
			//
			// returns:
			//		the target string
			//
			if(!defaultView){ defaultView = ""}
			while(hash.indexOf("(") > 0){ 
				var index = hash.indexOf("(");
				var endindex = hash.indexOf(")");
				var viewPart = hash.substring(index,endindex+1);
				var viewName = viewPart.substring(1,viewPart.indexOf("&"));
				hash = hash.replace(viewPart, viewName);
			}	
			
			return (((hash && hash.charAt(0) == "#") ? hash.substr(1) : hash) || defaultView).split('&')[0];	// String
		}
};

return hashUtil;

});
},
'dojox/app/utils/constraints':function(){
define(["dojo/_base/array"], function(arr){
	var constraints = [];
	return {
		getSelectedChild: function(view, constraint){
			// summary:
			//		get current selected child according to the constraint
			//
			// view: View
			//		the View to get the child from
			// constraint: Object
			//		tbe constraint object
			//
			// returns:
			//		the selected child view for this constraint
			var type = typeof(constraint);
			var hash = (type == "string" || type == "number") ? constraint : constraint.__hash;
			return (view && view.selectedChildren && view.selectedChildren[hash]) ?
				view.selectedChildren[hash] : null;
		},

		setSelectedChild: function(view, constraint, child){
			// summary:
			//		set current selected child according to the constraint
			//
			// view: View
			//		the View to set the selected child to
			// constraint: Object
			//		tbe constraint object
			// child: View
			//		the child to select
			var type = typeof(constraint);
			var hash = (type == "string" || type == "number") ? constraint : constraint.__hash;
			view.selectedChildren[hash] = child;
		},


		getAllSelectedChildren: function(view, selChildren){
			// summary:
			//		get current all selected children for this view and it's selected subviews
			//
			// view: View
			//		the View to get the child from
			//
			// selChildren: Array
			//		the Array of the subChildren found
			//
			// returns:
			//		selChildren array of all of the selected child views
			//
			selChildren = selChildren || [];
			if(view && view.selectedChildren){
				for(var hash in view.selectedChildren){
					if(view.selectedChildren[hash]){
						var subChild = view.selectedChildren[hash];
						selChildren.push(subChild);
						this.getAllSelectedChildren(subChild, selChildren);
					}
				}
			}
			return selChildren;
		},

		register: function(constraint){
			// if the constraint has already been registered we don't care about it...
			var type = typeof(constraint);
			if(!constraint.__hash && type != "string" && type != "number"){
				var match = null;
				arr.some(constraints, function(item){
					var ok = true;
					for(var prop in item){
						if(prop.charAt(0) !== "_"){//skip the private properties
							if(item[prop] != constraint[prop]){
								ok = false;
								break;
							}
						}
					}
					if(ok == true){
						match = item;
					}
					return ok;
				});
				if(match){
					constraint.__hash = match.__hash;
				}else{
					// create a new "hash"
					var hash = "";
					for(var prop in constraint){
						if(prop.charAt(0) !== "_"){
							hash += constraint[prop];
						}
					}
					constraint.__hash = hash;
					constraints.push(constraint);
				}
			}
		}
	};
});
},
'dojox/app/utils/config':function(){
define(["dojo/sniff"], function(has){

// module:
//		dojox/app/utils/config

return {
	// summary:
	//		This module contains the config

	configProcessHas: function(/*Object*/ source){
		// summary:
		//		scan the source config for has checks and call configMerge to merge has sections, and remove the has sections from the source.
		// description:
		//		configProcessHas will scan the source config for has checks. 
		//		For each has section the items inside the has section will be tested with has (sniff)
		//		If the has test is true it will call configMerge to merge has sections back into the source config.
		//		It will always remove the has section from the source after processing it.
		//		The names in the has section can be separated by a comma, indicating that any of those being true will satisfy the test.
		// source:
		//		an object representing the config to be processed.
		// returns:
		//		the updated source object.
		for(var name in source){
			var	sval = source[name];
			if(name == "has"){ // found a "has" section in source
				for(var hasname in sval){ // get the hasnames from the has section
					if(!(hasname.charAt(0) == '_' && hasname.charAt(1) == '_') && sval && typeof sval === 'object'){
						// need to handle multiple has checks separated by a ",".
						var parts = hasname.split(',');
						if(parts.length > 0){
							while(parts.length > 0){ 	
								var haspart = parts.shift();
								// check for has(haspart) or if haspart starts with ! check for !(has(haspart))
								if((has(haspart)) || (haspart.charAt(0) == '!' && !(has(haspart.substring(1))))){ // if true this one should be merged
									var hasval = sval[hasname];
									this.configMerge(source, hasval); // merge this has section into the source config
									break;	// found a match for this multiple has test, so go to the next one
								}
							}
						}
					}
				}
				delete source["has"];	// after merge remove this has section from the config
			}else{
				if(!(name.charAt(0) == '_' && name.charAt(1) == '_') && sval && typeof sval === 'object'){
						this.configProcessHas(sval);
				}
			}
		}
		return source;
	},

	configMerge: function(/*Object*/ target, /*Object*/ source){
		// summary:
		//		does a deep copy of the source into the target to merge the config from the source into the target
		// description:
		//		configMerge will merge the source config into the target config with a deep copy.
		//		anything starting with __ will be skipped and if the target is an array the source items will be pushed into the target.
		// target:
		//		an object representing the config which will be updated by merging in the source.
		// source:
		//		an object representing the config to be merged into the target.
		// returns:
		//		the updated target object.

		for(var name in source){
			var tval = target[name];
			var	sval = source[name];
			if(tval !== sval && !(name.charAt(0) == '_' && name.charAt(1) == '_')){
				if(tval && typeof tval === 'object' && sval && typeof sval === 'object'){
					this.configMerge(tval, sval);
				}else{
					if(target instanceof Array){
						target.push(sval);
					}else{
						target[name] = sval;
					}
				}
			}
		}
		return target;
	}
};

});

},
'dojox/json/ref':function(){
define([
	"dojo/_base/array",
	"dojo/_base/json",
	"dojo/_base/kernel", 
	"dojo/_base/lang",
	"dojo/date/stamp",
	"dojox"
],
function(array, djson, dojo, lang, stamp, dojox){

lang.getObject("json", true, dojox);

return dojox.json.ref = {
	// summary:
	//		Adds advanced JSON {de}serialization capabilities to the base json library.
	//		This enhances the capabilities of dojo.toJson and dojo.fromJson,
	//		adding referencing support, date handling, and other extra format handling.
	//		On parsing, references are resolved. When references are made to
	//		ids/objects that have been loaded yet, the loader function will be set to
	//		_loadObject to denote a lazy loading (not loaded yet) object.


	resolveJson: function(/*Object*/ root, /*Object?*/ args){
		// summary:
		//		Indexes and resolves references in the JSON object.
		// description:
		//		A JSON Schema object that can be used to advise the handling of the JSON (defining ids, date properties, urls, etc)
		// root:
		//		The root object of the object graph to be processed
		// args:
		//		Object with additional arguments:
		//
		//		- The *index* parameter:
		//			This is the index object (map) to use to store an index of all the objects.
		//			If you are using inter-message referencing, you must provide the same object for each call.
		//		- The *defaultId* parameter:
		//			This is the default id to use for the root object (if it doesn't define it's own id)
		//		- The *idPrefix* parameter:
		//			This the prefix to use for the ids as they enter the index. This allows multiple tables
		//			to use ids (that might otherwise collide) that enter the same global index.
		//			idPrefix should be in the form "/Service/".  For example,
		//			if the idPrefix is "/Table/", and object is encountered {id:"4",...}, this would go in the
		//			index as "/Table/4".
		//		- The *idAttribute* parameter:
		//			This indicates what property is the identity property. This defaults to "id"
		//		- The *assignAbsoluteIds* parameter:
		//			This indicates that the resolveJson should assign absolute ids (__id) as the objects are being parsed.
		//		- The *schemas* parameter:
		//			This provides a map of schemas, from which prototypes can be retrieved
		//		- The *loader* parameter:
		//			This is a function that is called added to the reference objects that can't be resolved (lazy objects)
		// returns:
		//		An object, the result of the processing
		args = args || {};
		var idAttribute = args.idAttribute || 'id';
		var refAttribute = this.refAttribute;
		var idAsRef = args.idAsRef;
		var prefix = args.idPrefix || '';
		var assignAbsoluteIds = args.assignAbsoluteIds;
		var index = args.index || {}; // create an index if one doesn't exist
		var timeStamps = args.timeStamps;
		var ref,reWalk=[];
		var pathResolveRegex = /^(.*\/)?(\w+:\/\/)|[^\/\.]+\/\.\.\/|^.*\/(\/)/;
		var addProp = this._addProp;
		var F = function(){};
		function walk(it, stop, defaultId, needsPrefix, schema, defaultObject){
			// this walks the new graph, resolving references and making other changes
		 	var i, update, val, id = idAttribute in it ? it[idAttribute] : defaultId;
		 	if(idAttribute in it || ((id !== undefined) && needsPrefix)){
		 		id = (prefix + id).replace(pathResolveRegex,'$2$3');
		 	}
		 	var target = defaultObject || it;
			if(id !== undefined){ // if there is an id available...
				if(assignAbsoluteIds){
					it.__id = id;
				}
				if(args.schemas && (!(it instanceof Array)) && // won't try on arrays to do prototypes, plus it messes with queries
		 					(val = id.match(/^(.+\/)[^\.\[]*$/))){ // if it has a direct table id (no paths)
		 			schema = args.schemas[val[1]];
				}
				// if the id already exists in the system, we should use the existing object, and just
				// update it... as long as the object is compatible
				if(index[id] && ((it instanceof Array) == (index[id] instanceof Array))){
					target = index[id];
					delete target.$ref; // remove this artifact
					delete target._loadObject;
					update = true;
				}else{
				 	var proto = schema && schema.prototype; // and if has a prototype
					if(proto){
						// if the schema defines a prototype, that needs to be the prototype of the object
						F.prototype = proto;
						target = new F();
					}
				}
				index[id] = target; // add the prefix, set _id, and index it
				if(timeStamps){
					timeStamps[id] = args.time;
				}
			}
			while(schema){
				var properties = schema.properties;
				if(properties){
					for(i in it){
						var propertyDefinition = properties[i];
						if(propertyDefinition && propertyDefinition.format == 'date-time' && typeof it[i] == 'string'){
							it[i] = stamp.fromISOString(it[i]);
						}
					}
				}
				schema = schema["extends"];
			}
			var length = it.length;
			for(i in it){
				if(i==length){
					break;
				}
				if(it.hasOwnProperty(i)){
					val=it[i];
					if((typeof val =='object') && val && !(val instanceof Date) && i != '__parent'){
						ref=val[refAttribute] || (idAsRef && val[idAttribute]);
						if(!ref || !val.__parent){
							if(it != reWalk){
								val.__parent = target;
							}
						}
						if(ref){ // a reference was found
							// make sure it is a safe reference
							delete it[i];// remove the property so it doesn't resolve to itself in the case of id.propertyName lazy values
							var path = ref.toString().replace(/(#)([^\.\[])/,'$1.$2').match(/(^([^\[]*\/)?[^#\.\[]*)#?([\.\[].*)?/); // divide along the path
							if(index[(prefix + ref).replace(pathResolveRegex,'$2$3')]){
								ref = index[(prefix + ref).replace(pathResolveRegex,'$2$3')];
							}else if((ref = (path[1]=='$' || path[1]=='this' || path[1]=='') ? root : index[(prefix + path[1]).replace(pathResolveRegex,'$2$3')])){  // a $ indicates to start with the root, otherwise start with an id
								// if there is a path, we will iterate through the path references
								if(path[3]){
									path[3].replace(/(\[([^\]]+)\])|(\.?([^\.\[]+))/g,function(t,a,b,c,d){
										ref = ref && ref[b ? b.replace(/[\"\'\\]/,'') : d];
									});
								}
							}
							if(ref){
								val = ref;
							}else{
								// otherwise, no starting point was found (id not found), if stop is set, it does not exist, we have
								// unloaded reference, if stop is not set, it may be in a part of the graph not walked yet,
								// we will wait for the second loop
								if(!stop){
									var rewalking;
									if(!rewalking){
										reWalk.push(target); // we need to rewalk it to resolve references
									}
									rewalking = true; // we only want to add it once
									val = walk(val, false, val[refAttribute], true, propertyDefinition);
									// create a lazy loaded object
									val._loadObject = args.loader;
								}
							}
						}else{
							if(!stop){ // if we are in stop, that means we are in the second loop, and we only need to check this current one,
								// further walking may lead down circular loops
								val = walk(
									val,
									reWalk==it,
									id === undefined ? undefined : addProp(id, i), // the default id to use
									false,
									propertyDefinition,
									// if we have an existing object child, we want to
									// maintain it's identity, so we pass it as the default object
									target != it && typeof target[i] == 'object' && target[i]
								);
							}
						}
					}
					it[i] = val;
					if(target!=it && !target.__isDirty){// do updates if we are updating an existing object and it's not dirty
						var old = target[i];
						target[i] = val; // only update if it changed
						if(update && val !== old && // see if it is different
								!target._loadObject && // no updates if we are just lazy loading
								!(i.charAt(0) == '_' && i.charAt(1) == '_') && i != "$ref" &&
								!(val instanceof Date && old instanceof Date && val.getTime() == old.getTime()) && // make sure it isn't an identical date
								!(typeof val == 'function' && typeof old == 'function' && val.toString() == old.toString()) && // make sure it isn't an indentical function
								index.onUpdate){
							index.onUpdate(target,i,old,val); // call the listener for each update
						}
					}
				}
			}
	
			if(update && (idAttribute in it || target instanceof Array)){
				// this means we are updating with a full representation of the object, we need to remove deleted
				for(i in target){
					if(!target.__isDirty && target.hasOwnProperty(i) && !it.hasOwnProperty(i) && !(i.charAt(0) == '_' && i.charAt(1) == '_') && !(target instanceof Array && isNaN(i))){
						if(index.onUpdate && i != "_loadObject" && i != "_idAttr"){
							index.onUpdate(target,i,target[i],undefined); // call the listener for each update
						}
						delete target[i];
						while(target instanceof Array && target.length && target[target.length-1] === undefined){
							// shorten the target if necessary
							target.length--;
						}
					}
				}
			}else{
				if(index.onLoad){
					index.onLoad(target);
				}
			}
			return target;
		}
		if(root && typeof root == 'object'){
			root = walk(root,false,args.defaultId, true); // do the main walk through
			walk(reWalk,false); // re walk any parts that were not able to resolve references on the first round
		}
		return root;
	},


	fromJson: function(/*String*/ str,/*Object?*/ args){
	// summary:
	//		evaluates the passed string-form of a JSON object.
	// str:
	//		a string literal of a JSON item, for instance:
	// |	'{ "foo": [ "bar", 1, { "baz": "thud" } ] }'
	// args:
	//		See resolveJson
	// returns:
	//		An object, the result of the evaluation
		function ref(target){ // support call styles references as well
			var refObject = {};
			refObject[this.refAttribute] = target;
			return refObject;
		}
		try{
			var root = eval('(' + str + ')'); // do the eval
		}catch(e){
			throw new SyntaxError("Invalid JSON string: " + e.message + " parsing: "+ str);
		}
		if(root){
			return this.resolveJson(root, args);
		}
		return root;
	},
	
	toJson: function(/*Object*/ it, /*Boolean?*/ prettyPrint, /*Object?*/ idPrefix, /*Object?*/ indexSubObjects){
		// summary:
		//		Create a JSON serialization of an object.
		//		This has support for referencing, including circular references, duplicate references, and out-of-message references
		//		id and path-based referencing is supported as well and is based on http://www.json.com/2007/10/19/json-referencing-proposal-and-library/.
		// it:
		//		an object to be serialized.
		// prettyPrint:
		//		if true, we indent objects and arrays to make the output prettier.
		//		The variable dojo.toJsonIndentStr is used as the indent string
		//		-- to use something other than the default (tab),
		//		change that variable before calling dojo.toJson().
		// idPrefix:
		//		The prefix that has been used for the absolute ids
		// returns:
		//		a String representing the serialized version of the passed object.
		var useRefs = this._useRefs;
		var addProp = this._addProp;
		var refAttribute = this.refAttribute;
		idPrefix = idPrefix || ''; // the id prefix for this context
		var paths={};
		var generated = {};
		function serialize(it,path,_indentStr){
			if(typeof it == 'object' && it){
				var value;
				if(it instanceof Date){ // properly serialize dates
					return '"' + stamp.toISOString(it,{zulu:true}) + '"';
				}
				var id = it.__id;
				if(id){ // we found an identifiable object, we will just serialize a reference to it... unless it is the root
					if(path != '#' && ((useRefs && !id.match(/#/)) || paths[id])){
						var ref = id;
						if(id.charAt(0)!='#'){
							if(it.__clientId == id){
								ref = "cid:" + id;
							}else if(id.substring(0, idPrefix.length) == idPrefix){ // see if the reference is in the current context
								// a reference with a prefix matching the current context, the prefix should be removed
								ref = id.substring(idPrefix.length);
							}else{
								// a reference to a different context, assume relative url based referencing
								ref = id;
							}
						}
						var refObject = {};
						refObject[refAttribute] = ref;
						return djson.toJson(refObject, prettyPrint);
					}
					path = id;
				}else{
					it.__id = path; // we will create path ids for other objects in case they are circular
					generated[path] = it;
				}
				paths[path] = it;// save it here so they can be deleted at the end
				_indentStr = _indentStr || "";
				var nextIndent = prettyPrint ? _indentStr + djson.toJsonIndentStr : "";
				var newLine = prettyPrint ? "\n" : "";
				var sep = prettyPrint ? " " : "";
	
				if(it instanceof Array){
					var res = array.map(it, function(obj,i){
						var val = serialize(obj, addProp(path, i), nextIndent);
						if(typeof val != "string"){
							val = "undefined";
						}
						return newLine + nextIndent + val;
					});
					return "[" + res.join("," + sep) + newLine + _indentStr + "]";
				}
	
				var output = [];
				for(var i in it){
					if(it.hasOwnProperty(i)){
						var keyStr;
						if(typeof i == "number"){
							keyStr = '"' + i + '"';
						}else if(typeof i == "string" && (i.charAt(0) != '_' || i.charAt(1) != '_')){
							// we don't serialize our internal properties __id and __clientId
							keyStr = djson._escapeString(i);
						}else{
							// skip non-string or number keys
							continue;
						}
						var val = serialize(it[i],addProp(path, i),nextIndent);
						if(typeof val != "string"){
							// skip non-serializable values
							continue;
						}
						output.push(newLine + nextIndent + keyStr + ":" + sep + val);
					}
				}
				return "{" + output.join("," + sep) + newLine + _indentStr + "}";
			}else if(typeof it == "function" && dojox.json.ref.serializeFunctions){
				return it.toString();
			}
	
			return djson.toJson(it); // use the default serializer for primitives
		}
		var json = serialize(it,'#','');
		if(!indexSubObjects){
			for(var i in generated)  {// cleanup the temporary path-generated ids
				delete generated[i].__id;
			}
		}
		return json;
	},
	_addProp: function(id, prop){
		return id + (id.match(/#/) ? id.length == 1 ? '' : '.' : '#') + prop;
	},
	// refAttribute: String
	//		This indicates what property is the reference property. This acts like the idAttribute
	//		except that this is used to indicate the current object is a reference or only partially
	//		loaded. This defaults to "$ref".
	refAttribute: "$ref",
	_useRefs: false,
	serializeFunctions: false
};
});

},
'dojo/date/stamp':function(){
define(["../_base/lang", "../_base/array"], function(lang, array){

// module:
//		dojo/date/stamp

var stamp = {
	// summary:
	//		TODOC
};
lang.setObject("dojo.date.stamp", stamp);

// Methods to convert dates to or from a wire (string) format using well-known conventions

stamp.fromISOString = function(/*String*/ formattedString, /*Number?*/ defaultTime){
	// summary:
	//		Returns a Date object given a string formatted according to a subset of the ISO-8601 standard.
	//
	// description:
	//		Accepts a string formatted according to a profile of ISO8601 as defined by
	//		[RFC3339](http://www.ietf.org/rfc/rfc3339.txt), except that partial input is allowed.
	//		Can also process dates as specified [by the W3C](http://www.w3.org/TR/NOTE-datetime)
	//		The following combinations are valid:
	//
	//		- dates only
	//			- yyyy
	//			- yyyy-MM
	//			- yyyy-MM-dd
	//		- times only, with an optional time zone appended
	//			- THH:mm
	//			- THH:mm:ss
	//			- THH:mm:ss.SSS
	//		- and "datetimes" which could be any combination of the above
	//
	//		timezones may be specified as Z (for UTC) or +/- followed by a time expression HH:mm
	//		Assumes the local time zone if not specified.  Does not validate.  Improperly formatted
	//		input may return null.  Arguments which are out of bounds will be handled
	//		by the Date constructor (e.g. January 32nd typically gets resolved to February 1st)
	//		Only years between 100 and 9999 are supported.
  	// formattedString:
	//		A string such as 2005-06-30T08:05:00-07:00 or 2005-06-30 or T08:05:00
	// defaultTime:
	//		Used for defaults for fields omitted in the formattedString.
	//		Uses 1970-01-01T00:00:00.0Z by default.

	if(!stamp._isoRegExp){
		stamp._isoRegExp =
//TODO: could be more restrictive and check for 00-59, etc.
			/^(?:(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(.\d+)?)?((?:[+-](\d{2}):(\d{2}))|Z)?)?$/;
	}

	var match = stamp._isoRegExp.exec(formattedString),
		result = null;

	if(match){
		match.shift();
		if(match[1]){match[1]--;} // Javascript Date months are 0-based
		if(match[6]){match[6] *= 1000;} // Javascript Date expects fractional seconds as milliseconds

		if(defaultTime){
			// mix in defaultTime.  Relatively expensive, so use || operators for the fast path of defaultTime === 0
			defaultTime = new Date(defaultTime);
			array.forEach(array.map(["FullYear", "Month", "Date", "Hours", "Minutes", "Seconds", "Milliseconds"], function(prop){
				return defaultTime["get" + prop]();
			}), function(value, index){
				match[index] = match[index] || value;
			});
		}
		result = new Date(match[0]||1970, match[1]||0, match[2]||1, match[3]||0, match[4]||0, match[5]||0, match[6]||0); //TODO: UTC defaults
		if(match[0] < 100){
			result.setFullYear(match[0] || 1970);
		}

		var offset = 0,
			zoneSign = match[7] && match[7].charAt(0);
		if(zoneSign != 'Z'){
			offset = ((match[8] || 0) * 60) + (Number(match[9]) || 0);
			if(zoneSign != '-'){ offset *= -1; }
		}
		if(zoneSign){
			offset -= result.getTimezoneOffset();
		}
		if(offset){
			result.setTime(result.getTime() + offset * 60000);
		}
	}

	return result; // Date or null
};

/*=====
var __Options = {
	// selector: String
	//		"date" or "time" for partial formatting of the Date object.
	//		Both date and time will be formatted by default.
	// zulu: Boolean
	//		if true, UTC/GMT is used for a timezone
	// milliseconds: Boolean
	//		if true, output milliseconds
};
=====*/

stamp.toISOString = function(/*Date*/ dateObject, /*__Options?*/ options){
	// summary:
	//		Format a Date object as a string according a subset of the ISO-8601 standard
	//
	// description:
	//		When options.selector is omitted, output follows [RFC3339](http://www.ietf.org/rfc/rfc3339.txt)
	//		The local time zone is included as an offset from GMT, except when selector=='time' (time without a date)
	//		Does not check bounds.  Only years between 100 and 9999 are supported.
	//
	// dateObject:
	//		A Date object

	var _ = function(n){ return (n < 10) ? "0" + n : n; };
	options = options || {};
	var formattedDate = [],
		getter = options.zulu ? "getUTC" : "get",
		date = "";
	if(options.selector != "time"){
		var year = dateObject[getter+"FullYear"]();
		date = ["0000".substr((year+"").length)+year, _(dateObject[getter+"Month"]()+1), _(dateObject[getter+"Date"]())].join('-');
	}
	formattedDate.push(date);
	if(options.selector != "date"){
		var time = [_(dateObject[getter+"Hours"]()), _(dateObject[getter+"Minutes"]()), _(dateObject[getter+"Seconds"]())].join(':');
		var millis = dateObject[getter+"Milliseconds"]();
		if(options.milliseconds){
			time += "."+ (millis < 100 ? "0" : "") + _(millis);
		}
		if(options.zulu){
			time += "Z";
		}else if(options.selector != "time"){
			var timezoneOffset = dateObject.getTimezoneOffset();
			var absOffset = Math.abs(timezoneOffset);
			time += (timezoneOffset > 0 ? "-" : "+") +
				_(Math.floor(absOffset/60)) + ":" + _(absOffset%60);
		}
		formattedDate.push(time);
	}
	return formattedDate.join('T'); // String
};

return stamp;
});

},
'dojox/main':function(){
define(["dojo/_base/kernel"], function(dojo) {
	// module:
	//		dojox/main

	/*=====
	return {
		// summary:
		//		The dojox package main module; dojox package is somewhat unusual in that the main module currently just provides an empty object.
		//		Apps should require modules from the dojox packages directly, rather than loading this module.
	};
	=====*/

	return dojo.dojox;
});
},
'dojo/text':function(){
define(["./_base/kernel", "require", "./has", "./request"], function(dojo, require, has, request){
	// module:
	//		dojo/text

	var getText;
	if( 1 ){
		getText= function(url, sync, load){
			request(url, {sync:!!sync}).then(load);
		};
	}else{
		// Path for node.js and rhino, to load from local file system.
		// TODO: use node.js native methods rather than depending on a require.getText() method to exist.
		if(require.getText){
			getText= require.getText;
		}else{
			console.error("dojo/text plugin failed to load because loader does not support getText");
		}
	}

	var
		theCache = {},

		strip= function(text){
			//Strips <?xml ...?> declarations so that external SVG and XML
			//documents can be added to a document without worry. Also, if the string
			//is an HTML document, only the part inside the body tag is returned.
			if(text){
				text= text.replace(/^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im, "");
				var matches= text.match(/<body[^>]*>\s*([\s\S]+)\s*<\/body>/im);
				if(matches){
					text= matches[1];
				}
			}else{
				text = "";
			}
			return text;
		},

		notFound = {},

		pending = {};

	dojo.cache = function(/*String||Object*/module, /*String*/url, /*String||Object?*/value){
		// summary:
		//		A getter and setter for storing the string content associated with the
		//		module and url arguments.
		// description:
		//		If module is a string that contains slashes, then it is interpretted as a fully
		//		resolved path (typically a result returned by require.toUrl), and url should not be
		//		provided. This is the preferred signature. If module is a string that does not
		//		contain slashes, then url must also be provided and module and url are used to
		//		call `dojo.moduleUrl()` to generate a module URL. This signature is deprecated.
		//		If value is specified, the cache value for the moduleUrl will be set to
		//		that value. Otherwise, dojo.cache will fetch the moduleUrl and store it
		//		in its internal cache and return that cached value for the URL. To clear
		//		a cache value pass null for value. Since XMLHttpRequest (XHR) is used to fetch the
		//		the URL contents, only modules on the same domain of the page can use this capability.
		//		The build system can inline the cache values though, to allow for xdomain hosting.
		// module: String||Object
		//		If a String with slashes, a fully resolved path; if a String without slashes, the
		//		module name to use for the base part of the URL, similar to module argument
		//		to `dojo.moduleUrl`. If an Object, something that has a .toString() method that
		//		generates a valid path for the cache item. For example, a dojo._Url object.
		// url: String
		//		The rest of the path to append to the path derived from the module argument. If
		//		module is an object, then this second argument should be the "value" argument instead.
		// value: String||Object?
		//		If a String, the value to use in the cache for the module/url combination.
		//		If an Object, it can have two properties: value and sanitize. The value property
		//		should be the value to use in the cache, and sanitize can be set to true or false,
		//		to indicate if XML declarations should be removed from the value and if the HTML
		//		inside a body tag in the value should be extracted as the real value. The value argument
		//		or the value property on the value argument are usually only used by the build system
		//		as it inlines cache content.
		// example:
		//		To ask dojo.cache to fetch content and store it in the cache (the dojo["cache"] style
		//		of call is used to avoid an issue with the build system erroneously trying to intern
		//		this example. To get the build system to intern your dojo.cache calls, use the
		//		"dojo.cache" style of call):
		//		| //If template.html contains "<h1>Hello</h1>" that will be
		//		| //the value for the text variable.
		//		| var text = dojo["cache"]("my.module", "template.html");
		// example:
		//		To ask dojo.cache to fetch content and store it in the cache, and sanitize the input
		//		 (the dojo["cache"] style of call is used to avoid an issue with the build system
		//		erroneously trying to intern this example. To get the build system to intern your
		//		dojo.cache calls, use the "dojo.cache" style of call):
		//		| //If template.html contains "<html><body><h1>Hello</h1></body></html>", the
		//		| //text variable will contain just "<h1>Hello</h1>".
		//		| var text = dojo["cache"]("my.module", "template.html", {sanitize: true});
		// example:
		//		Same example as previous, but demonstrates how an object can be passed in as
		//		the first argument, then the value argument can then be the second argument.
		//		| //If template.html contains "<html><body><h1>Hello</h1></body></html>", the
		//		| //text variable will contain just "<h1>Hello</h1>".
		//		| var text = dojo["cache"](new dojo._Url("my/module/template.html"), {sanitize: true});

		//	 * (string string [value]) => (module, url, value)
		//	 * (object [value])        => (module, value), url defaults to ""
		//
		//	 * if module is an object, then it must be convertable to a string
		//	 * (module, url) module + (url ? ("/" + url) : "") must be a legal argument to require.toUrl
		//	 * value may be a string or an object; if an object then may have the properties "value" and/or "sanitize"
		var key;
		if(typeof module=="string"){
			if(/\//.test(module)){
				// module is a version 1.7+ resolved path
				key = module;
				value = url;
			}else{
				// module is a version 1.6- argument to dojo.moduleUrl
				key = require.toUrl(module.replace(/\./g, "/") + (url ? ("/" + url) : ""));
			}
		}else{
			key = module + "";
			value = url;
		}
		var
			val = (value != undefined && typeof value != "string") ? value.value : value,
			sanitize = value && value.sanitize;

		if(typeof val == "string"){
			//We have a string, set cache value
			theCache[key] = val;
			return sanitize ? strip(val) : val;
		}else if(val === null){
			//Remove cached value
			delete theCache[key];
			return null;
		}else{
			//Allow cache values to be empty strings. If key property does
			//not exist, fetch it.
			if(!(key in theCache)){
				getText(key, true, function(text){
					theCache[key]= text;
				});
			}
			return sanitize ? strip(theCache[key]) : theCache[key];
		}
	};

	return {
		// summary:
		//		This module implements the dojo/text! plugin and the dojo.cache API.
		// description:
		//		We choose to include our own plugin to leverage functionality already contained in dojo
		//		and thereby reduce the size of the plugin compared to various foreign loader implementations.
		//		Also, this allows foreign AMD loaders to be used without their plugins.
		//
		//		CAUTION: this module is designed to optionally function synchronously to support the dojo v1.x synchronous
		//		loader. This feature is outside the scope of the CommonJS plugins specification.

		// the dojo/text caches it's own resources because of dojo.cache
		dynamic: true,

		normalize: function(id, toAbsMid){
			// id is something like (path may be relative):
			//
			//	 "path/to/text.html"
			//	 "path/to/text.html!strip"
			var parts= id.split("!"),
				url= parts[0];
			return (/^\./.test(url) ? toAbsMid(url) : url) + (parts[1] ? "!" + parts[1] : "");
		},

		load: function(id, require, load){
			// id: String
			//		Path to the resource.
			// require: Function
			//		Object that include the function toUrl with given id returns a valid URL from which to load the text.
			// load: Function
			//		Callback function which will be called, when the loading finished.

			// id is something like (path is always absolute):
			//
			//	 "path/to/text.html"
			//	 "path/to/text.html!strip"
			var
				parts= id.split("!"),
				stripFlag= parts.length>1,
				absMid= parts[0],
				url = require.toUrl(parts[0]),
				requireCacheUrl = "url:" + url,
				text = notFound,
				finish = function(text){
					load(stripFlag ? strip(text) : text);
				};
			if(absMid in theCache){
				text = theCache[absMid];
			}else if(require.cache && requireCacheUrl in require.cache){
				text = require.cache[requireCacheUrl];
			}else if(url in theCache){
				text = theCache[url];
			}
			if(text===notFound){
				if(pending[url]){
					pending[url].push(finish);
				}else{
					var pendingList = pending[url] = [finish];
					getText(url, !require.async, function(text){
						theCache[absMid]= theCache[url]= text;
						for(var i = 0; i<pendingList.length;){
							pendingList[i++](text);
						}
						delete pending[url];
					});
				}
			}else{
				finish(text);
			}
		}
	};

});


},
'dojo/request':function(){
define([
	'./request/default!'/*=====,
	'./_base/declare',
	'./promise/Promise' =====*/
], function(request/*=====, declare, Promise =====*/){
	/*=====
	request = function(url, options){
		// summary:
		//		Send a request using the default transport for the current platform.
		// url: String
		//		The URL to request.
		// options: dojo/request.__Options?
		//		Options for the request.
		// returns: dojo/request.__Promise
	};
	request.__Promise = declare(Promise, {
		// response: dojo/promise/Promise
		//		A promise resolving to an object representing
		//		the response from the server.
	});
	request.__BaseOptions = declare(null, {
		// query: String|Object?
		//		Query parameters to append to the URL.
		// data: String|Object?
		//		Data to transfer.  This is ignored for GET and DELETE
		//		requests.
		// preventCache: Boolean?
		//		Whether to append a cache-busting parameter to the URL.
		// timeout: Integer?
		//		Milliseconds to wait for the response.  If this time
		//		passes, the then the promise is rejected.
		// handleAs: String?
		//		How to handle the response from the server.  Default is
		//		'text'.  Other values are 'json', 'javascript', and 'xml'.
	});
	request.__MethodOptions = declare(null, {
		// method: String?
		//		The HTTP method to use to make the request.  Must be
		//		uppercase.
	});
	request.__Options = declare([request.__BaseOptions, request.__MethodOptions]);

	request.get = function(url, options){
		// summary:
		//		Send an HTTP GET request using the default transport for the current platform.
		// url: String
		//		URL to request
		// options: dojo/request.__BaseOptions?
		//		Options for the request.
		// returns: dojo/request.__Promise
	};
	request.post = function(url, options){
		// summary:
		//		Send an HTTP POST request using the default transport for the current platform.
		// url: String
		//		URL to request
		// options: dojo/request.__BaseOptions?
		//		Options for the request.
		// returns: dojo/request.__Promise
	};
	request.put = function(url, options){
		// summary:
		//		Send an HTTP POST request using the default transport for the current platform.
		// url: String
		//		URL to request
		// options: dojo/request.__BaseOptions?
		//		Options for the request.
		// returns: dojo/request.__Promise
	};
	request.del = function(url, options){
		// summary:
		//		Send an HTTP DELETE request using the default transport for the current platform.
		// url: String
		//		URL to request
		// options: dojo/request.__BaseOptions?
		//		Options for the request.
		// returns: dojo/request.__Promise
	};
	=====*/
	return request;
});

},
'dojo/request/default':function(){
define([
	'exports',
	'require',
	'../has'
], function(exports, require, has){
	var defId = has('config-requestProvider'),
		platformId;

	if( 1 ){
		platformId = './xhr';
	}else if( 0 ){
		platformId = './node';
	/* TODO:
	}else if( 0 ){
		platformId = './rhino';
   */
	}

	if(!defId){
		defId = platformId;
	}

	exports.getPlatformDefaultId = function(){
		return platformId;
	};

	exports.load = function(id, parentRequire, loaded, config){
		require([id == 'platform' ? platformId : defId], function(provider){
			loaded(provider);
		});
	};
});

},
'dojo/store/Observable':function(){
define(["../_base/kernel", "../_base/lang", "../when", "../_base/array" /*=====, "./api/Store" =====*/
], function(kernel, lang, when, array /*=====, Store =====*/){

// module:
//		dojo/store/Observable

var Observable = function(/*Store*/ store){
	// summary:
	//		The Observable store wrapper takes a store and sets an observe method on query()
	//		results that can be used to monitor results for changes.
	//
	// description:
	//		Observable wraps an existing store so that notifications can be made when a query
	//		is performed.
	//
	// example:
	//		Create a Memory store that returns an observable query, and then log some
	//		information about that query.
	//
	//	|	var store = Observable(new Memory({
	//	|		data: [
	//	|			{id: 1, name: "one", prime: false},
	//	|			{id: 2, name: "two", even: true, prime: true},
	//	|			{id: 3, name: "three", prime: true},
	//	|			{id: 4, name: "four", even: true, prime: false},
	//	|			{id: 5, name: "five", prime: true}
	//	|		]
	//	|	}));
	//	|	var changes = [], results = store.query({ prime: true });
	//	|	var observer = results.observe(function(object, previousIndex, newIndex){
	//	|		changes.push({previousIndex:previousIndex, newIndex:newIndex, object:object});
	//	|	});
	//
	//		See the Observable tests for more information.

	var undef, queryUpdaters = [], revision = 0;
	// a Comet driven store could directly call notify to notify observers when data has
	// changed on the backend
	// create a new instance
	store = lang.delegate(store);
	
	store.notify = function(object, existingId){
		revision++;
		var updaters = queryUpdaters.slice();
		for(var i = 0, l = updaters.length; i < l; i++){
			updaters[i](object, existingId);
		}
	};
	var originalQuery = store.query;
	store.query = function(query, options){
		options = options || {};
		var results = originalQuery.apply(this, arguments);
		if(results && results.forEach){
			var nonPagedOptions = lang.mixin({}, options);
			delete nonPagedOptions.start;
			delete nonPagedOptions.count;

			var queryExecutor = store.queryEngine && store.queryEngine(query, nonPagedOptions);
			var queryRevision = revision;
			var listeners = [], queryUpdater;
			results.observe = function(listener, includeObjectUpdates){
				if(listeners.push(listener) == 1){
					// first listener was added, create the query checker and updater
					queryUpdaters.push(queryUpdater = function(changed, existingId){
						when(results, function(resultsArray){
							var atEnd = resultsArray.length != options.count;
							var i, l, listener;
							if(++queryRevision != revision){
								throw new Error("Query is out of date, you must observe() the query prior to any data modifications");
							}
							var removedObject, removedFrom = -1, insertedInto = -1;
							if(existingId !== undef){
								// remove the old one
								for(i = 0, l = resultsArray.length; i < l; i++){
									var object = resultsArray[i];
									if(store.getIdentity(object) == existingId){
										removedObject = object;
										removedFrom = i;
										if(queryExecutor || !changed){// if it was changed and we don't have a queryExecutor, we shouldn't remove it because updated objects would be eliminated
											resultsArray.splice(i, 1);
										}
										break;
									}
								}
							}
							if(queryExecutor){
								// add the new one
								if(changed &&
										// if a matches function exists, use that (probably more efficient)
										(queryExecutor.matches ? queryExecutor.matches(changed) : queryExecutor([changed]).length)){

									var firstInsertedInto = removedFrom > -1 ? 
										removedFrom : // put back in the original slot so it doesn't move unless it needs to (relying on a stable sort below)
										resultsArray.length;
									resultsArray.splice(firstInsertedInto, 0, changed); // add the new item
									insertedInto = array.indexOf(queryExecutor(resultsArray), changed); // sort it
									// we now need to push the chagne back into the original results array
									resultsArray.splice(firstInsertedInto, 1); // remove the inserted item from the previous index
									
									if((options.start && insertedInto == 0) ||
										(!atEnd && insertedInto == resultsArray.length)){
										// if it is at the end of the page, assume it goes into the prev or next page
										insertedInto = -1;
									}else{
										resultsArray.splice(insertedInto, 0, changed); // and insert into the results array with the correct index
									}
								}
							}else if(changed){
								// we don't have a queryEngine, so we can't provide any information
								// about where it was inserted or moved to. If it is an update, we leave it's position alone, other we at least indicate a new object
								if(existingId !== undef){
									// an update, keep the index the same
									insertedInto = removedFrom;
								}else if(!options.start){
									// a new object
									insertedInto = store.defaultIndex || 0;
									resultsArray.splice(insertedInto, 0, changed);
								}
							}
							if((removedFrom > -1 || insertedInto > -1) &&
									(includeObjectUpdates || !queryExecutor || (removedFrom != insertedInto))){
								var copyListeners = listeners.slice();
								for(i = 0;listener = copyListeners[i]; i++){
									listener(changed || removedObject, removedFrom, insertedInto);
								}
							}
						});
					});
				}
				var handle = {};
				// TODO: Remove cancel in 2.0.
				handle.remove = handle.cancel = function(){
					// remove this listener
					var index = array.indexOf(listeners, listener);
					if(index > -1){ // check to make sure we haven't already called cancel
						listeners.splice(index, 1);
						if(!listeners.length){
							// no more listeners, remove the query updater too
							queryUpdaters.splice(array.indexOf(queryUpdaters, queryUpdater), 1);
						}
					}
				};
				return handle;
			};
		}
		return results;
	};
	var inMethod;
	function whenFinished(method, action){
		var original = store[method];
		if(original){
			store[method] = function(value){
				if(inMethod){
					// if one method calls another (like add() calling put()) we don't want two events
					return original.apply(this, arguments);
				}
				inMethod = true;
				try{
					var results = original.apply(this, arguments);
					when(results, function(results){
						action((typeof results == "object" && results) || value);
					});
					return results;
				}finally{
					inMethod = false;
				}
			};
		}
	}
	// monitor for updates by listening to these methods
	whenFinished("put", function(object){
		store.notify(object, store.getIdentity(object));
	});
	whenFinished("add", function(object){
		store.notify(object);
	});
	whenFinished("remove", function(id){
		store.notify(undefined, id);
	});

	return store;
};

lang.setObject("dojo.store.Observable", Observable);

return Observable;
});

},
'dojox/app/controllers/History':function(){
define(["dojo/_base/lang", "dojo/_base/declare", "dojo/on", "../Controller", "../utils/hash", "dojo/topic"],
function(lang, declare, on, Controller, hash, topic){
	// module:
	//		dojox/app/controllers/History
	// summary:
	//		Bind "app-domNode" event on dojox/app application instance.
	//		Bind "startTransition" event on dojox/app application domNode.
	//		Bind "popstate" event on window object.
	//		Maintain history by HTML5 "pushState" method and "popstate" event.

	return declare("dojox.app.controllers.History", Controller, {
		// _currentPosition:     Integer
		//              Persistent variable which indicates the current position/index in the history
		//              (so as to be able to figure out whether the popState event was triggerd by
		//              a backward or forward action).
		_currentPosition: 0,

		// currentState: Object
		//              Current state
		currentState: {},

		constructor: function(){
			// summary:
			//		Bind "app-domNode" event on dojox/app application instance.
			//		Bind "startTransition" event on dojox/app application domNode.
			//		Bind "popstate" event on window object.
			//

			this.events = {
				"app-domNode": this.onDomNodeChange
			};
			if(this.app.domNode){
				this.onDomNodeChange({oldNode: null, newNode: this.app.domNode});
			}
			this.bind(window, "popstate", lang.hitch(this, this.onPopState));
		},

		onDomNodeChange: function(evt){
			if(evt.oldNode != null){
				this.unbind(evt.oldNode, "startTransition");
			}
			this.bind(evt.newNode, "startTransition", lang.hitch(this, this.onStartTransition));
		},

		onStartTransition: function(evt){
			// summary:
			//		Response to dojox/app "startTransition" event.
			//
			// example:
			//		Use "dojox/mobile/TransitionEvent" to trigger "startTransition" event, and this function will response the event. For example:
			//		|	var transOpts = {
			//		|		title:"List",
			//		|		target:"items,list",
			//		|		url: "#items,list",
			//		|		params: {"param1":"p1value"}
			//		|	};
			//		|	new TransitionEvent(domNode, transOpts, e).dispatch();
			//
			// evt: Object
			//		Transition options parameter
			var currentHash = window.location.hash;
			var currentView = hash.getTarget(currentHash, this.app.defaultView);
			var currentParams =  hash.getParams(currentHash);
			var _detail = lang.clone(evt.detail);
			_detail.target = _detail.title = currentView;
			_detail.url = currentHash;
			_detail.params = currentParams;
			_detail.id = this._currentPosition;

			// Create initial state if necessary
			if(history.length == 1){
				history.pushState(_detail, _detail.href, currentHash);
			}

			// Update the current state
			_detail.bwdTransition = _detail.transition;
			lang.mixin(this.currentState, _detail);
			history.replaceState(this.currentState, this.currentState.href, currentHash);

			// Create a new "current state" history entry
			this._currentPosition += 1;
			evt.detail.id = this._currentPosition;

			var newHash = evt.detail.url || "#" + evt.detail.target;

			if(evt.detail.params){
				newHash = hash.buildWithParams(newHash, evt.detail.params);
			}

			evt.detail.fwdTransition = evt.detail.transition;
			history.pushState(evt.detail, evt.detail.href, newHash);
			this.currentState = lang.clone(evt.detail);

			// Finally: Publish pushState topic
			topic.publish("/app/history/pushState", evt.detail.target);
		},

		onPopState: function(evt){
			// summary:
			//		Response to dojox/app "popstate" event.
			//
			// evt: Object
			//		Transition options parameter

			// Clean browser's cache and refresh the current page will trigger popState event,
			// but in this situation the application has not started and throws an error.
			// So we need to check application status, if application not STARTED, do nothing.
			if((this.app.getStatus() !== this.app.lifecycle.STARTED) || !evt.state ){
				return;
			}

			// Get direction of navigation and update _currentPosition accordingly
			var backward = evt.state.id < this._currentPosition;
			backward ? this._currentPosition -= 1 : this._currentPosition += 1;

			// Publish popState topic and transition to the target view. Important: Use correct transition.
			// Reverse transitionDir only if the user navigates backwards.
			var opts = lang.mixin({reverse: backward ? true : false}, evt.state);
			opts.transition = backward ? opts.bwdTransition : opts.fwdTransition;
			this.app.emit("app-transition", {
				viewId: evt.state.target,
				opts: opts
			});
			topic.publish("/app/history/popState", evt.state.target);
		}
	});
});

},
'dojox/app/Controller':function(){
define(["dojo/_base/lang", "dojo/_base/declare", "dojo/on"], function(lang, declare, on){
	// module:
	//		dojox/app/Controller
	// summary:
	//		Bind events on dojox/app application's dojo/Evented instance or document.

	return declare("dojox.app.Controller", null, {
		constructor: function(app, events){
			// summary:
			//		bind events on application dojo/Evented instance.
			//		bind css selector events on document.
			//
			// app:
			//		dojox/app application instance.
			// events:
			//		{event : handler}

			this.events = this.events || events;
			this._boundEvents = [];
			this.app = app;
		},

		bind: function(evented, event, handler){
			// summary:
			//		Bind event on dojo/Evented instance, document, domNode or window.
			//		Save event signal in controller instance. If no parameter is provided
			//		automatically bind all events registered in controller events property.
			//
			// evented: Object
			//		dojo/Evented instance, document, domNode or window
			// event: String
			//		event
			// handler: Function
			//		event handler
			if(arguments.length == 0){
				if(this.events){
					for(var item in this.events){
						if(item.charAt(0) !== "_"){//skip the private properties
							this.bind(this.app, item, lang.hitch(this, this.events[item]));
						}
					}
				}
			}else{
				var signal = on(evented, event, handler);
				this._boundEvents.push({
					"event": event,
					"evented": evented,
					"signal": signal
				});
			}
			return this;
		},

		unbind: function(evented, event){
			// summary:
			//		remove a binded event signal.
			//
			// evented: Object
			//		dojo/Evented instance, document, domNode or window
			// event: String
			//		event

			var len = this._boundEvents.length;
			for(var i = 0; i < len; i++){
				if((this._boundEvents[i]['event'] == event) && (this._boundEvents[i]['evented'] == evented)){
					this._boundEvents[i]['signal'].remove();
					this._boundEvents.splice(i, 1);
					return;
				}
			}
			console.warn("event '"+event+"' not bind on ", evented);
			return this;
		}
	});
});

},
'dojox/app/controllers/HistoryHash':function(){
define(["dojo/_base/lang", "dojo/_base/declare", "dojo/topic", "dojo/on", "../Controller", "../utils/hash", "dojo/hash"],
	function(lang, declare, topic, on, Controller, hash){
	// module:
	//		dojox/app/controllers/HistoryHash
	// summary:
	//		Bind "app-domNode" event on dojox/app application instance,
	//		Bind "startTransition" event on dojox/app application domNode,
	//		Bind "/dojo/hashchange" event on window object.
	//		Maintain history by history hash.

	return declare("dojox.app.controllers.HistoryHash", Controller, {

		constructor: function(app){
			// summary:
			//		Bind "app-domNode" event on dojox/app application instance,
			//		Bind "startTransition" event on dojox/app application domNode,
			//		subscribe "/dojo/hashchange" event.
			//
			// app:
			//		dojox/app application instance.
			this.events = {
				"app-domNode": this.onDomNodeChange
			};
			if(this.app.domNode){
				this.onDomNodeChange({oldNode: null, newNode: this.app.domNode});
			}
			topic.subscribe("/dojo/hashchange", lang.hitch(this, function(newhash){
				this._onHashChange(newhash);
			}));

			this._historyStack = []; // application history stack
			this._historyLen = 0;	// current window.history length
			this._historyDiff = 0; // the diff of window.history stack and application history stack 
			this._current = null;	// current history item in application history stack
			this._next = null;		// next history item in application history stack
			this._previous = null;	// previous history item in application history stack
			this._index = 0;		// identify current history item's index in application history stack
			this._oldHistoryLen = 0;// window.history stack length before hash change
			this._newHistoryLen = 0;// window.history stack length after hash change
			this._addToHistoryStack = false;
			this._startTransitionEvent = false;

			// push the default page to the history stack
			var currentHash = window.location.hash;
			if(currentHash && (currentHash.length > 1)){
				currentHash = currentHash.substr(1);
			}
			this._historyStack.push({
				"hash": currentHash,
				"url": window.location.href,
				"detail": {target:currentHash}
			});
			this._historyLen = window.history.length;
			this._index = this._historyStack.length - 1;
			this._current = currentHash;

			// get the diff of window.history and application history
			this._historyDiff = window.history.length - this._historyStack.length;
		},

		onDomNodeChange: function(evt){
			if(evt.oldNode != null){
				this.unbind(evt.oldNode, "startTransition");
			}
			this.bind(evt.newNode, "startTransition", lang.hitch(this, this.onStartTransition));
		},

		onStartTransition: function(evt){
			// summary:
			//		Response to dojox/app "startTransition" event.
			//
			// example:
			//		Use "dojox/mobile/TransitionEvent" to trigger "startTransition" event, and this function will response the event. For example:
			//		|	var transOpts = {
			//		|		title:"List",
			//		|		target:"items,list",
			//		|		url: "#items,list"
			//		|		params: {"param1":"p1value"}
			//		|	};
			//		|	new TransitionEvent(domNode, transOpts, e).dispatch();
			//
			// evt: Object
			//		transition options parameter

			var target = evt.detail.target;
			var regex = /#(.+)/;
			if(!target && regex.test(evt.detail.href)){
				target = evt.detail.href.match(regex)[1];
			}

			var currentHash = evt.detail.url || "#" + target;

			if(evt.detail.params){
				currentHash = hash.buildWithParams(currentHash, evt.detail.params);
			}

			this._oldHistoryLen = window.history.length;
			// pushState on iOS will not change location bar hash because of security.
			// window.history.pushState(evt.detail, title, currentHash);

			// history.length will be changed by set location hash
			// change url hash, to workaround iOS pushState not change address bar issue.
			window.location.hash = currentHash;

			// The operation above will trigger hashchange.
			// Use _addToHistoryStack flag to indicate the _onHashChange method should add this hash to history stack.
			// When add hash to history stack, this flag should be set to false, we do this in _addHistory.
			this._addToHistoryStack = true;
			//set startTransition event flag to true if the hash change from startTransition event.
			this._startTransitionEvent = true;
		},

		_addHistory: function(hash){
			// summary:
			//		Add hash to application history stack, update history management flags.
			//
			// hash:
			//		new hash should be added to _historyStack.
			this._historyStack.push({
				"hash": hash,
				"url": window.location.href,
				"detail": {target:hash}
			});

			this._historyLen = window.history.length;
			this._index = this._historyStack.length - 1;

			this._previous = this._current;
			this._current = hash;
			this._next = null;

			this._historyDiff = window.history.length - this._historyStack.length;

			// In order to make sure _addToHistoryStack flag invalid after add hash to history stack,
			// we set this flag to false in every addHistory operation even if it's already false.
			this._addToHistoryStack = false;
		},

		_onHashChange: function(currentHash){
			// summary:
			//		subscribe /dojo/hashchange and do add history, back, forward and go operation.
			//
			// currentHash:
			//		the new url hash when /dojo/hashchange is triggered.

			if(this._index < 0 || this._index > (window.history.length - 1)){
				throw Error("Application history out of management.");
			}

			this._newHistoryLen = window.history.length;

			// Application history stack asynchronized with window.history, refresh application history stack.
			if(this._oldHistoryLen > this._newHistoryLen){
				//console.log("need to refresh _historyStack, oldLen:"+this._oldHistoryLen+", newLen: "+this._newHistoryLen+", diff:"+this._historyDiff);
				this._historyStack.splice((this._newHistoryLen - this._historyDiff - 1), (this._historyStack.length - 1));

				// Reset _historyLen to make sure this._historyLen<window.history.length, so it will push this hash to history stack.
				this._historyLen = this._historyStack.length;

				// Reset this._oldHistoryLen, so it can avoid refresh history stack again in some situation,
				// because by doing this, this._oldHistoryLen !== this._newHistoryLen
				this._oldHistoryLen = 0;
			}

			// this._oldHistoryLen === this._newHistoryLen, it maybe need to refresh history stack or do history go, back and forward,
			// so we use _addToHistoryStack to identify the refresh operation.
			if(this._addToHistoryStack && (this._oldHistoryLen === this._newHistoryLen)){
				this._historyStack.splice((this._newHistoryLen - this._historyDiff - 1), (this._historyStack.length - 1));
				this._addHistory(currentHash);

				// It's a refresh operation, so that's no need to check history go, back or forward, just return.
				return;
			}

			//window.history.length increase, add hash to application history stack.
			if(this._historyLen < window.history.length){
				this._addHistory(currentHash);
				if(!this._startTransitionEvent){
					// transition to the target view
					this.app.emit("app-transition", {
						viewId: hash.getTarget(currentHash),
						opts: { params: hash.getParams(currentHash) || {} }
					});
				}
			}else{
				if(currentHash == this._current){
					// console.log("do nothing.");
				}else if(currentHash === this._previous){ // back
					this._back(currentHash, this._historyStack[this._index]["detail"]);
				}else if(currentHash === this._next){ //forward
					this._forward(currentHash, this._historyStack[this._index]["detail"]);
				}else{ // go
					//search in "back" first, then "forward"
					var index = -1;
					for(var i = this._index; i > 0; i--){
						if(currentHash === this._historyStack[i]["hash"]){
							index = i;
							break;
						}
					}

					//search in "forward"
					if(-1 === index){
						for(var i = this._index; i < this._historyStack.length; i++){
							if(currentHash === this._historyStack[i]["hash"]){
								index = i;
								break;
							}
						}
					}

					if(0 < index < this._historyStack.length){
						this._go(index, (index - this._index));
					}else{
						this.app.log("go error. index out of history stack.");
					}
				}
			}
			// set startTransition event flag to false
			this._startTransitionEvent = false;
		},

		_back: function(currentHash, detail){
			this.app.log("back");
			this._next = this._historyStack[this._index]["hash"];
			this._index--;
			if(this._index > 0){
				this._previous = this._historyStack[this._index - 1]["hash"];
			}else{
				this._previous = null;
			}
			this._current = currentHash;

			var target = hash.getTarget(currentHash, this.app.defaultView);

			// publish history back event
			topic.publish("/app/history/back", {"viewId": target, "detail": detail});

			// transition to the target view
			this.app.emit("app-transition", {
				viewId: target,
 				opts: lang.mixin({reverse: true}, detail, {"params": hash.getParams(currentHash)})
			});
		},

		_forward: function(currentHash, detail){
			this.app.log("forward");
			this._previous = this._historyStack[this._index]["hash"];
			this._index++;
			if(this._index < this._historyStack.length - 1){
				this._next = this._historyStack[this._index + 1]["hash"];
			}else{
				this._next = null;
			}
			this._current = currentHash;

			var target = hash.getTarget(currentHash, this.app.defaultView);

			// publish history forward event
			topic.publish("/app/history/forward", {"viewId": target, "detail": detail});

			// transition to the target view
			this.app.emit("app-transition", {
				viewId: target,
 				opts: lang.mixin({reverse: false}, detail, {"params": hash.getParams(currentHash)})
			});
		},

		_go: function(index, step){
			if(index < 0 || (index > window.history.length - 1)){
				throw Error("Application history.go steps out of management, index: "+index+" length: "+window.history.length);
			}

			this._index = index;
			this._current = this._historyStack[index]["hash"];
			this._previous = this._historyStack[index - 1] ? this._historyStack[index - 1]["hash"] : null;
			this._next = this._historyStack[index + 1] ? this._historyStack[index + 1]["hash"] : null;

			var target = hash.getTarget(this._current, this.app.defaultView);

			// publish history go event
			topic.publish("/app/history/go", {"viewId": target, "step": step, "detail": this._historyStack[index]["detail"]});

			// transition to the target view
			this.app.emit("app-transition", {
				viewId: target,
				opts: lang.mixin({reverse: (step <= 0)}, this._historyStack[index]["detail"], {"params": hash.getParams(this._current)})
			});
		}
	});
});

},
'dojo/hash':function(){
define(["./_base/kernel", "require", "./_base/config", "./aspect", "./_base/lang", "./topic", "./domReady", "./sniff"],
	function(dojo, require, config, aspect, lang, topic, domReady, has){

	// module:
	//		dojo/hash

	dojo.hash = function(/* String? */ hash, /* Boolean? */ replace){
		// summary:
		//		Gets or sets the hash string in the browser URL.
		// description:
		//		Handles getting and setting of location.hash.
		//
		//		 - If no arguments are passed, acts as a getter.
		//		 - If a string is passed, acts as a setter.
		// hash:
		//		the hash is set - #string.
		// replace:
		//		If true, updates the hash value in the current history
		//		state instead of creating a new history state.
		// returns:
		//		when used as a getter, returns the current hash string.
		//		when used as a setter, returns the new hash string.
		// example:
		//	|	topic.subscribe("/dojo/hashchange", context, callback);
		//	|
		//	|	function callback (hashValue){
		//	|		// do something based on the hash value.
		//	|	}

		// getter
		if(!arguments.length){
			return _getHash();
		}
		// setter
		if(hash.charAt(0) == "#"){
			hash = hash.substring(1);
		}
		if(replace){
			_replace(hash);
		}else{
			location.href = "#" + hash;
		}
		return hash; // String
	};

	// Global vars
	var _recentHash, _ieUriMonitor, _connect,
		_pollFrequency = config.hashPollFrequency || 100;

	//Internal functions
	function _getSegment(str, delimiter){
		var i = str.indexOf(delimiter);
		return (i >= 0) ? str.substring(i+1) : "";
	}

	function _getHash(){
		return _getSegment(location.href, "#");
	}

	function _dispatchEvent(){
		topic.publish("/dojo/hashchange", _getHash());
	}

	function _pollLocation(){
		if(_getHash() === _recentHash){
			return;
		}
		_recentHash = _getHash();
		_dispatchEvent();
	}

	function _replace(hash){
		if(_ieUriMonitor){
			if(_ieUriMonitor.isTransitioning()){
				setTimeout(lang.hitch(null,_replace,hash), _pollFrequency);
				return;
			}
			var href = _ieUriMonitor.iframe.location.href;
			var index = href.indexOf('?');
			// main frame will detect and update itself
			_ieUriMonitor.iframe.location.replace(href.substring(0, index) + "?" + hash);
			return;
		}
		location.replace("#"+hash);
		!_connect && _pollLocation();
	}

	function IEUriMonitor(){
		// summary:
		//		Determine if the browser's URI has changed or if the user has pressed the
		//		back or forward button. If so, call _dispatchEvent.
		//
		// description:
		//		IE doesn't add changes to the URI's hash into the history unless the hash
		//		value corresponds to an actual named anchor in the document. To get around
		//		this IE difference, we use a background IFrame to maintain a back-forward
		//		history, by updating the IFrame's query string to correspond to the
		//		value of the main browser location's hash value.
		//
		//		E.g. if the value of the browser window's location changes to
		//
		//		#action=someAction
		//
		//		... then we'd update the IFrame's source to:
		//
		//		?action=someAction
		//
		//		This design leads to a somewhat complex state machine, which is
		//		described below:
		//
		//		####s1
		//
		//		Stable state - neither the window's location has changed nor
		//		has the IFrame's location. Note that this is the 99.9% case, so
		//		we optimize for it.
		//
		//		Transitions: s1, s2, s3
		//
		//		####s2
		//
		//		Window's location changed - when a user clicks a hyperlink or
		//		code programmatically changes the window's URI.
		//
		//		Transitions: s4
		//
		//		####s3
		//
		//		Iframe's location changed as a result of user pressing back or
		//		forward - when the user presses back or forward, the location of
		//		the background's iframe changes to the previous or next value in
		//		its history.
		//
		//		Transitions: s1
		//
		//		####s4
		//
		//		IEUriMonitor has programmatically changed the location of the
		//		background iframe, but it's location hasn't yet changed. In this
		//		case we do nothing because we need to wait for the iframe's
		//		location to reflect its actual state.
		//
		//		Transitions: s4, s5
		//
		//		####s5
		//
		//		IEUriMonitor has programmatically changed the location of the
		//		background iframe, and the iframe's location has caught up with
		//		reality. In this case we need to transition to s1.
		//
		//		Transitions: s1
		//
		//		The hashchange event is always dispatched on the transition back to s1.


		// create and append iframe
		var ifr = document.createElement("iframe"),
			IFRAME_ID = "dojo-hash-iframe",
			ifrSrc = config.dojoBlankHtmlUrl || require.toUrl("./resources/blank.html");

		if(config.useXDomain && !config.dojoBlankHtmlUrl){
			console.warn("dojo.hash: When using cross-domain Dojo builds,"
				+ " please save dojo/resources/blank.html to your domain and set djConfig.dojoBlankHtmlUrl"
				+ " to the path on your domain to blank.html");
		}

		ifr.id = IFRAME_ID;
		ifr.src = ifrSrc + "?" + _getHash();
		ifr.style.display = "none";
		document.body.appendChild(ifr);

		this.iframe = dojo.global[IFRAME_ID];
		var recentIframeQuery, transitioning, expectedIFrameQuery, docTitle, ifrOffline,
			iframeLoc = this.iframe.location;

		function resetState(){
			_recentHash = _getHash();
			recentIframeQuery = ifrOffline ? _recentHash : _getSegment(iframeLoc.href, "?");
			transitioning = false;
			expectedIFrameQuery = null;
		}

		this.isTransitioning = function(){
			return transitioning;
		};

		this.pollLocation = function(){
			if(!ifrOffline){
				try{
					//see if we can access the iframe's location without a permission denied error
					var iframeSearch = _getSegment(iframeLoc.href, "?");
					//good, the iframe is same origin (no thrown exception)
					if(document.title != docTitle){ //sync title of main window with title of iframe.
						docTitle = this.iframe.document.title = document.title;
					}
				}catch(e){
					//permission denied - server cannot be reached.
					ifrOffline = true;
					console.error("dojo.hash: Error adding history entry. Server unreachable.");
				}
			}
			var hash = _getHash();
			if(transitioning && _recentHash === hash){
				// we're in an iframe transition (s4 or s5)
				if(ifrOffline || iframeSearch === expectedIFrameQuery){
					// s5 (iframe caught up to main window or iframe offline), transition back to s1
					resetState();
					_dispatchEvent();
				}else{
					// s4 (waiting for iframe to catch up to main window)
					setTimeout(lang.hitch(this,this.pollLocation),0);
					return;
				}
			}else if(_recentHash === hash && (ifrOffline || recentIframeQuery === iframeSearch)){
				// we're in stable state (s1, iframe query == main window hash), do nothing
			}else{
				// the user has initiated a URL change somehow.
				// sync iframe query <-> main window hash
				if(_recentHash !== hash){
					// s2 (main window location changed), set iframe url and transition to s4
					_recentHash = hash;
					transitioning = true;
					expectedIFrameQuery = hash;
					ifr.src = ifrSrc + "?" + expectedIFrameQuery;
					ifrOffline = false; //we're updating the iframe src - set offline to false so we can check again on next poll.
					setTimeout(lang.hitch(this,this.pollLocation),0); //yielded transition to s4 while iframe reloads.
					return;
				}else if(!ifrOffline){
					// s3 (iframe location changed via back/forward button), set main window url and transition to s1.
					location.href = "#" + iframeLoc.search.substring(1);
					resetState();
					_dispatchEvent();
				}
			}
			setTimeout(lang.hitch(this,this.pollLocation), _pollFrequency);
		};
		resetState(); // initialize state (transition to s1)
		setTimeout(lang.hitch(this,this.pollLocation), _pollFrequency);
	}
	domReady(function(){
		if("onhashchange" in dojo.global && (!has("ie") || (has("ie") >= 8 && document.compatMode != "BackCompat"))){	//need this IE browser test because "onhashchange" exists in IE8 in IE7 mode
			_connect = aspect.after(dojo.global,"onhashchange",_dispatchEvent, true);
		}else{
			if(document.addEventListener){ // Non-IE
				_recentHash = _getHash();
				setInterval(_pollLocation, _pollFrequency); //Poll the window location for changes
			}else if(document.attachEvent){ // IE7-
				//Use hidden iframe in versions of IE that don't have onhashchange event
				_ieUriMonitor = new IEUriMonitor();
			}
			// else non-supported browser, do nothing.
		}
	});

	return dojo.hash;

});

},
'dojox/mobile/common':function(){
define([
	"dojo/_base/array",
	"dojo/_base/config",
	"dojo/_base/connect",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/_base/kernel",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/ready",
	"dojo/touch",
	"dijit/registry",
	"./sniff",
	"./uacss" // (no direct references)
], function(array, config, connect, lang, win, kernel, domClass, domConstruct, ready, touch, registry, has){

	// module:
	//		dojox/mobile/common

	var dm = lang.getObject("dojox.mobile", true);

	// tell dojo/touch to generate synthetic clicks immediately
	// and regardless of preventDefault() calls on touch events
	win.doc.dojoClick = true;
	/// ... but let user disable this by removing dojoClick from the document
	if(has("touch")){
		// Do we need to send synthetic clicks when preventDefault() is called on touch events?
		// This is normally true on anything except Android 4.1+ and IE10, but users reported
		// exceptions like Galaxy Note 2. So let's use a has("clicks-prevented") flag, and let
		// applications override it through data-dojo-config="has:{'clicks-prevented':true}" if needed.
		has.add("clicks-prevented", !(has("android") >= 4.1 || has("ie") >= 10));
		if(has("clicks-prevented")){
			dm._sendClick = function(target, e){
				// dojo/touch will send a click if dojoClick is set, so don't do it again.
				for(var node = target; node; node = node.parentNode){
					if(node.dojoClick){
						return;
					}
				}
				var ev = win.doc.createEvent("MouseEvents"); 
				ev.initMouseEvent("click", true, true, win.global, 1, e.screenX, e.screenY, e.clientX, e.clientY); 
				target.dispatchEvent(ev);
			};
		}
	}

	dm.getScreenSize = function(){
		// summary:
		//		Returns the dimensions of the browser window.
		return {
			h: win.global.innerHeight || win.doc.documentElement.clientHeight,
			w: win.global.innerWidth || win.doc.documentElement.clientWidth
		};
	};

	dm.updateOrient = function(){
		// summary:
		//		Updates the orientation specific CSS classes, 'dj_portrait' and
		//		'dj_landscape'.
		var dim = dm.getScreenSize();
		domClass.replace(win.doc.documentElement,
				  dim.h > dim.w ? "dj_portrait" : "dj_landscape",
				  dim.h > dim.w ? "dj_landscape" : "dj_portrait");
	};
	dm.updateOrient();

	dm.tabletSize = 500;
	dm.detectScreenSize = function(/*Boolean?*/force){
		// summary:
		//		Detects the screen size and determines if the screen is like
		//		phone or like tablet. If the result is changed,
		//		it sets either of the following css class to `<html>`:
		//
		//		- 'dj_phone'
		//		- 'dj_tablet'
		//
		//		and it publishes either of the following events:
		//
		//		- '/dojox/mobile/screenSize/phone'
		//		- '/dojox/mobile/screenSize/tablet'

		var dim = dm.getScreenSize();
		var sz = Math.min(dim.w, dim.h);
		var from, to;
		if(sz >= dm.tabletSize && (force || (!this._sz || this._sz < dm.tabletSize))){
			from = "phone";
			to = "tablet";
		}else if(sz < dm.tabletSize && (force || (!this._sz || this._sz >= dm.tabletSize))){
			from = "tablet";
			to = "phone";
		}
		if(to){
			domClass.replace(win.doc.documentElement, "dj_"+to, "dj_"+from);
			connect.publish("/dojox/mobile/screenSize/"+to, [dim]);
		}
		this._sz = sz;
	};
	dm.detectScreenSize();

	// dojox/mobile.hideAddressBarWait: Number
	//		The time in milliseconds to wait before the fail-safe hiding address
	//		bar runs. The value must be larger than 800.
	dm.hideAddressBarWait = typeof(config["mblHideAddressBarWait"]) === "number" ?
		config["mblHideAddressBarWait"] : 1500;

	dm.hide_1 = function(){
		// summary:
		//		Internal function to hide the address bar.
		// tags:
		//		private
		scrollTo(0, 1);
		dm._hidingTimer = (dm._hidingTimer == 0) ? 200 : dm._hidingTimer * 2;
		setTimeout(function(){ // wait for a while for "scrollTo" to finish
			if(dm.isAddressBarHidden() || dm._hidingTimer > dm.hideAddressBarWait){
				// Succeeded to hide address bar, or failed but timed out 
				dm.resizeAll();
				dm._hiding = false;
			}else{
				// Failed to hide address bar, so retry after a while
				setTimeout(dm.hide_1, dm._hidingTimer);
			}
		}, 50); //50ms is an experiential value
	};

	dm.hideAddressBar = function(/*Event?*/evt){
		// summary:
		//		Hides the address bar.
		// description:
		//		Tries to hide the address bar a couple of times. The purpose is to do 
		//		it as quick as possible while ensuring the resize is done after the hiding
		//		finishes.
		if(dm.disableHideAddressBar || dm._hiding){ return; }
		dm._hiding = true;
		dm._hidingTimer = has("ios") ? 200 : 0; // Need to wait longer in case of iPhone
		var minH = screen.availHeight;
		if(has('android')){
			minH = outerHeight / devicePixelRatio;
			// On some Android devices such as Galaxy SII, minH might be 0 at this time.
			// In that case, retry again after a while. (200ms is an experiential value)
			if(minH == 0){
				dm._hiding = false;
				setTimeout(function(){ dm.hideAddressBar(); }, 200);
			}
			// On some Android devices such as HTC EVO, "outerHeight/devicePixelRatio"
			// is too short to hide address bar, so make it high enough
			if(minH <= innerHeight){ minH = outerHeight; }
			// On Android 2.2/2.3, hiding address bar fails when "overflow:hidden" style is
			// applied to html/body element, so force "overflow:visible" style
			if(has('android') < 3){
				win.doc.documentElement.style.overflow = win.body().style.overflow = "visible";
			}
		}
		if(win.body().offsetHeight < minH){ // to ensure enough height for scrollTo to work
			win.body().style.minHeight = minH + "px";
			dm._resetMinHeight = true;
		}
		setTimeout(dm.hide_1, dm._hidingTimer);
	};

	dm.isAddressBarHidden = function(){
		return pageYOffset === 1;
	};

	dm.resizeAll = function(/*Event?*/evt, /*Widget?*/root){
		// summary:
		//		Calls the resize() method of all the top level resizable widgets.
		// description:
		//		Finds all widgets that do not have a parent or the parent does not
		//		have the resize() method, and calls resize() for them.
		//		If a widget has a parent that has resize(), calling widget's
		//		resize() is its parent's responsibility.
		// evt:
		//		Native event object
		// root:
		//		If specified, searches the specified widget recursively for top-level
		//		resizable widgets.
		//		root.resize() is always called regardless of whether root is a
		//		top level widget or not.
		//		If omitted, searches the entire page.
		if(dm.disableResizeAll){ return; }
		connect.publish("/dojox/mobile/resizeAll", [evt, root]); // back compat
		connect.publish("/dojox/mobile/beforeResizeAll", [evt, root]);
		if(dm._resetMinHeight){
			win.body().style.minHeight = dm.getScreenSize().h + "px";
		} 
		dm.updateOrient();
		dm.detectScreenSize();
		var isTopLevel = function(w){
			var parent = w.getParent && w.getParent();
			return !!((!parent || !parent.resize) && w.resize);
		};
		var resizeRecursively = function(w){
			array.forEach(w.getChildren(), function(child){
				if(isTopLevel(child)){ child.resize(); }
				resizeRecursively(child);
			});
		};
		if(root){
			if(root.resize){ root.resize(); }
			resizeRecursively(root);
		}else{
			array.forEach(array.filter(registry.toArray(), isTopLevel),
					function(w){ w.resize(); });
		}
		connect.publish("/dojox/mobile/afterResizeAll", [evt, root]);
	};

	dm.openWindow = function(url, target){
		// summary:
		//		Opens a new browser window with the given URL.
		win.global.open(url, target || "_blank");
	};

	dm._detectWindowsTheme = function(){
		// summary:
		//		Detects if the "windows" theme is used,
		//		if it is used, set has("windows-theme") and
		//		add the .windows_theme class on the document.
		
		// Avoid unwanted (un)zoom on some WP8 devices (at least Nokia Lumia 920) 
		if(navigator.userAgent.match(/IEMobile\/10\.0/)){
			domConstruct.create("style", 
				{innerHTML: "@-ms-viewport {width: auto !important}"}, win.doc.head);
		}

		var setWindowsTheme = function(){
			domClass.add(win.doc.documentElement, "windows_theme");
			kernel.experimental("Dojo Mobile Windows theme", "Behavior and appearance of the Windows theme are experimental.");
		};

		// First see if the "windows-theme" feature has already been set explicitly
		// in that case skip aut-detect
		var windows = has("windows-theme");
		if(windows !== undefined){
			if(windows){
				setWindowsTheme();
			}
			return;
		}

		// check css
		var i, j;

		var check = function(href){
			// TODO: find a better regexp to match?
			if(href && href.indexOf("/windows/") !== -1){
				has.add("windows-theme", true);
				setWindowsTheme();
				return true;
			}
			return false;
		};

		// collect @import
		var s = win.doc.styleSheets;
		for(i = 0; i < s.length; i++){
			if(s[i].href){ continue; }
			var r = s[i].cssRules || s[i].imports;
			if(!r){ continue; }
			for(j = 0; j < r.length; j++){
				if(check(r[j].href)){
					return;
				}
			}
		}

		// collect <link>
		var elems = win.doc.getElementsByTagName("link");
		for(i = 0; i < elems.length; i++){
			if(check(elems[i].href)){
				return;
			}
		}
	};

	if(config["mblApplyPageStyles"] !== false){
		domClass.add(win.doc.documentElement, "mobile");
	}
	if(has('chrome')){
		// dojox/mobile does not load uacss (only _compat does), but we need dj_chrome.
		domClass.add(win.doc.documentElement, "dj_chrome");
	}

	if(win.global._no_dojo_dm){
		// deviceTheme seems to be loaded from a script tag (= non-dojo usage)
		var _dm = win.global._no_dojo_dm;
		for(var i in _dm){
			dm[i] = _dm[i];
		}
		dm.deviceTheme.setDm(dm);
	}

	// flag for Android transition animation flicker workaround
	has.add('mblAndroidWorkaround', 
			config["mblAndroidWorkaround"] !== false && has('android') < 3, undefined, true);
	has.add('mblAndroid3Workaround', 
			config["mblAndroid3Workaround"] !== false && has('android') >= 3, undefined, true);

	dm._detectWindowsTheme();
	
	ready(function(){
		dm.detectScreenSize(true);
		domClass.add(win.body(), "mblBackground");
		if(config["mblAndroidWorkaroundButtonStyle"] !== false && has('android')){
			// workaround for the form button disappearing issue on Android 2.2-4.0
			domConstruct.create("style", {innerHTML:"BUTTON,INPUT[type='button'],INPUT[type='submit'],INPUT[type='reset'],INPUT[type='file']::-webkit-file-upload-button{-webkit-appearance:none;} audio::-webkit-media-controls-play-button,video::-webkit-media-controls-play-button{-webkit-appearance:media-play-button;} video::-webkit-media-controls-fullscreen-button{-webkit-appearance:media-fullscreen-button;}"}, win.doc.head, "first");
		}
		if(has('mblAndroidWorkaround')){
			// add a css class to show view offscreen for android flicker workaround
			domConstruct.create("style", {innerHTML:".mblView.mblAndroidWorkaround{position:absolute;top:-9999px !important;left:-9999px !important;}"}, win.doc.head, "last");
		}

		//	You can disable hiding the address bar with the following dojoConfig.
		//	var dojoConfig = { mblHideAddressBar: false };
		var f = dm.resizeAll;
		if(config["mblHideAddressBar"] !== false &&
			navigator.appVersion.indexOf("Mobile") != -1 ||
			config["mblForceHideAddressBar"] === true){
			dm.hideAddressBar();
			if(config["mblAlwaysHideAddressBar"] === true){
				f = dm.hideAddressBar;
			}
		}

		var ios6 = has("ios") >= 6; // Full-screen support for iOS6 or later 
		if((has('android') || ios6) && win.global.onorientationchange !== undefined){
			var _f = f;
			var curSize, curClientWidth, curClientHeight;
			if(ios6){
				curClientWidth = win.doc.documentElement.clientWidth;
				curClientHeight = win.doc.documentElement.clientHeight;
			}else{ // Android
				// Call resize for the first resize event after orientationchange
				// because the size information may not yet be up to date when the 
				// event orientationchange occurs.
				f = function(evt){
					var _conn = connect.connect(null, "onresize", null, function(e){
						connect.disconnect(_conn);
						_f(e);
					});
				}
				curSize = dm.getScreenSize();
			};
			// Android: Watch for resize events when the virtual keyboard is shown/hidden.
			// The heuristic to detect this is that the screen width does not change
			// and the height changes by more than 100 pixels.
			//
			// iOS >= 6: Watch for resize events when entering or existing the new iOS6 
			// full-screen mode. The heuristic to detect this is that clientWidth does not
			// change while the clientHeight does change.
			connect.connect(null, "onresize", null, function(e){
				if(ios6){
					var newClientWidth = win.doc.documentElement.clientWidth,
						newClientHeight = win.doc.documentElement.clientHeight;
					if(newClientWidth == curClientWidth && newClientHeight != curClientHeight){
						// full-screen mode has been entered/exited (iOS6)
						_f(e);
					}
					curClientWidth = newClientWidth;
					curClientHeight = newClientHeight;
				}else{ // Android
					var newSize = dm.getScreenSize();
					if(newSize.w == curSize.w && Math.abs(newSize.h - curSize.h) >= 100){
						// keyboard has been shown/hidden (Android)
						_f(e);
					}
					curSize = newSize;
				}
			});
		}
		
		connect.connect(null, win.global.onorientationchange !== undefined
			? "onorientationchange" : "onresize", null, f);
		win.body().style.visibility = "visible";
	});

	// TODO: return functions declared above in this hash, rather than
	// dojox.mobile.

	/*=====
	return {
		// summary:
		//		A common module for dojox/mobile.
		// description:
		//		This module includes common utility functions that are used by
		//		dojox/mobile widgets. Also, it provides functions that are commonly
		//		necessary for mobile web applications, such as the hide address bar
		//		function.
	};
	=====*/
	return dm;
});

},
'dojo/touch':function(){
define(["./_base/kernel", "./aspect", "./dom", "./dom-class", "./_base/lang", "./on", "./has", "./mouse", "./domReady", "./_base/window"],
function(dojo, aspect, dom, domClass, lang, on, has, mouse, domReady, win){

	// module:
	//		dojo/touch

	var hasTouch = has("touch");

	var ios4 = has("ios") < 5;
	
	var msPointer = navigator.msPointerEnabled;

	// Click generation variables
	var clicksInited, clickTracker, clickTarget, clickX, clickY, clickDx, clickDy, clickTime;

	// Time of most recent touchstart, touchmove, or touchend event
	var lastTouch;

	function dualEvent(mouseType, touchType, msPointerType){
		// Returns synthetic event that listens for both the specified mouse event and specified touch event.
		// But ignore fake mouse events that were generated due to the user touching the screen.
		if(msPointer && msPointerType){
			// IE10+: MSPointer* events are designed to handle both mouse and touch in a uniform way,
			// so just use that regardless of hasTouch.
			return function(node, listener){
				return on(node, msPointerType, listener);
			}
		}else if(hasTouch){
			return function(node, listener){
				var handle1 = on(node, touchType, listener),
					handle2 = on(node, mouseType, function(evt){
						if(!lastTouch || (new Date()).getTime() > lastTouch + 1000){
							listener.call(this, evt);
						}
					});
				return {
					remove: function(){
						handle1.remove();
						handle2.remove();
					}
				};
			};
		}else{
			// Avoid creating listeners for touch events on performance sensitive older browsers like IE6
			return function(node, listener){
				return on(node, mouseType, listener);
			}
		}
	}

	function marked(/*DOMNode*/ node){
		// Test if a node or its ancestor has been marked with the dojoClick property to indicate special processing,
		do{
			if(node.dojoClick){ return node.dojoClick; }
		}while(node = node.parentNode);
	}
	
	function doClicks(e, moveType, endType){
		// summary:
		//		Setup touch listeners to generate synthetic clicks immediately (rather than waiting for the browser
		//		to generate clicks after the double-tap delay) and consistently (regardless of whether event.preventDefault()
		//		was called in an event listener. Synthetic clicks are generated only if a node or one of its ancestors has
		//		its dojoClick property set to truthy.
		
		clickTracker  = !e.target.disabled && marked(e.target); // click threshold = true, number or x/y object
		if(clickTracker){
			clickTarget = e.target;
			clickX = e.touches ? e.touches[0].pageX : e.clientX;
			clickY = e.touches ? e.touches[0].pageY : e.clientY;
			clickDx = (typeof clickTracker == "object" ? clickTracker.x : (typeof clickTracker == "number" ? clickTracker : 0)) || 4;
			clickDy = (typeof clickTracker == "object" ? clickTracker.y : (typeof clickTracker == "number" ? clickTracker : 0)) || 4;

			// add move/end handlers only the first time a node with dojoClick is seen,
			// so we don't add too much overhead when dojoClick is never set.
			if(!clicksInited){
				clicksInited = true;

				win.doc.addEventListener(moveType, function(e){
					clickTracker = clickTracker &&
						e.target == clickTarget &&
						Math.abs((e.touches ? e.touches[0].pageX : e.clientX) - clickX) <= clickDx &&
						Math.abs((e.touches ? e.touches[0].pageY : e.clientY) - clickY) <= clickDy;
				}, true);

				win.doc.addEventListener(endType, function(e){
					if(clickTracker){
						clickTime = (new Date()).getTime();
						var target = e.target;
						if(target.tagName === "LABEL"){
							// when clicking on a label, forward click to its associated input if any
							target = dom.byId(target.getAttribute("for")) || target;
						}
						setTimeout(function(){
							on.emit(target, "click", {
								bubbles : true,
								cancelable : true,
								_dojo_click : true
							});
						});
					}
				}, true);

				function stopNativeEvents(type){
					win.doc.addEventListener(type, function(e){
						// Stop native events when we emitted our own click event.  Note that the native click may occur
						// on a different node than the synthetic click event was generated on.  For example,
						// click on a menu item, causing the menu to disappear, and then (~300ms later) the browser
						// sends a click event to the node that was *underneath* the menu.  So stop all native events
						// sent shortly after ours, similar to what is done in dualEvent.
						// The INPUT.dijitOffScreen test is for offscreen inputs used in dijit/form/Button, on which
						// we call click() explicitly, we don't want to stop this event.
						if(!e._dojo_click &&
								(new Date()).getTime() <= clickTime + 1000 &&
								!(e.target.tagName == "INPUT" && domClass.contains(e.target, "dijitOffScreen"))){
							e.stopPropagation();
							e.stopImmediatePropagation && e.stopImmediatePropagation();
							if(type == "click" && (e.target.tagName != "INPUT" || e.target.type == "radio" || e.target.type == "checkbox")
								&& e.target.tagName != "TEXTAREA" && e.target.tagName != "AUDIO" && e.target.tagName != "VIDEO"){
								 // preventDefault() breaks textual <input>s on android, keyboard doesn't popup,
								 // but it is still needed for checkboxes and radio buttons, otherwise in some cases
								 // the checked state becomes inconsistent with the widget's state
								e.preventDefault();
							}
						}
					}, true);
				}

				stopNativeEvents("click");

				// We also stop mousedown/up since these would be sent well after with our "fast" click (300ms),
				// which can confuse some dijit widgets.
				stopNativeEvents("mousedown");
				stopNativeEvents("mouseup");
			}
		}
	}

	var hoveredNode;

	if(hasTouch){
		if(msPointer){
			 // MSPointer (IE10+) already has support for over and out, so we just need to init click support
			domReady(function(){
				win.doc.addEventListener("MSPointerDown", function(evt){
					doClicks(evt, "MSPointerMove", "MSPointerUp");
				}, true);
			});		
		}else{
			domReady(function(){
				// Keep track of currently hovered node
				hoveredNode = win.body();	// currently hovered node

				win.doc.addEventListener("touchstart", function(evt){
					lastTouch = (new Date()).getTime();

					// Precede touchstart event with touch.over event.  DnD depends on this.
					// Use addEventListener(cb, true) to run cb before any touchstart handlers on node run,
					// and to ensure this code runs even if the listener on the node does event.stop().
					var oldNode = hoveredNode;
					hoveredNode = evt.target;
					on.emit(oldNode, "dojotouchout", {
						relatedTarget: hoveredNode,
						bubbles: true
					});
					on.emit(hoveredNode, "dojotouchover", {
						relatedTarget: oldNode,
						bubbles: true
					});
				
					doClicks(evt, "touchmove", "touchend"); // init click generation
				}, true);

				function copyEventProps(evt){
					// Make copy of event object and also set bubbles:true.  Used when calling on.emit().
					var props = lang.delegate(evt, {
						bubbles: true
					});

					if(has("ios") >= 6){
						// On iOS6 "touches" became a non-enumerable property, which 
						// is not hit by for...in.  Ditto for the other properties below.
						props.touches = evt.touches;
						props.altKey = evt.altKey;
						props.changedTouches = evt.changedTouches;
						props.ctrlKey = evt.ctrlKey;
						props.metaKey = evt.metaKey;
						props.shiftKey = evt.shiftKey;
						props.targetTouches = evt.targetTouches;
					}

					return props;
				}
				
				on(win.doc, "touchmove", function(evt){
					lastTouch = (new Date()).getTime();

					var newNode = win.doc.elementFromPoint(
						evt.pageX - (ios4 ? 0 : win.global.pageXOffset), // iOS 4 expects page coords
						evt.pageY - (ios4 ? 0 : win.global.pageYOffset)
					);

					if(newNode){
						// Fire synthetic touchover and touchout events on nodes since the browser won't do it natively.
						if(hoveredNode !== newNode){
							// touch out on the old node
							on.emit(hoveredNode, "dojotouchout", {
								relatedTarget: newNode,
								bubbles: true
							});

							// touchover on the new node
							on.emit(newNode, "dojotouchover", {
								relatedTarget: hoveredNode,
								bubbles: true
							});

							hoveredNode = newNode;
						}

						// Unlike a listener on "touchmove", on(node, "dojotouchmove", listener) fires when the finger
						// drags over the specified node, regardless of which node the touch started on.
						on.emit(newNode, "dojotouchmove", copyEventProps(evt));
					}
				});

				// Fire a dojotouchend event on the node where the finger was before it was removed from the screen.
				// This is different than the native touchend, which fires on the node where the drag started.
				on(win.doc, "touchend", function(evt){
					lastTouch = (new Date()).getTime();
					var node = win.doc.elementFromPoint(
						evt.pageX - (ios4 ? 0 : win.global.pageXOffset), // iOS 4 expects page coords
						evt.pageY - (ios4 ? 0 : win.global.pageYOffset)
					) || win.body(); // if out of the screen

					on.emit(node, "dojotouchend", copyEventProps(evt));
				});
			});
		}
	}

	//device neutral events - touch.press|move|release|cancel/over/out
	var touch = {
		press: dualEvent("mousedown", "touchstart", "MSPointerDown"),
		move: dualEvent("mousemove", "dojotouchmove", "MSPointerMove"),
		release: dualEvent("mouseup", "dojotouchend", "MSPointerUp"),
		cancel: dualEvent(mouse.leave, "touchcancel", hasTouch?"MSPointerCancel":null),
		over: dualEvent("mouseover", "dojotouchover", "MSPointerOver"),
		out: dualEvent("mouseout", "dojotouchout", "MSPointerOut"),
		enter: mouse._eventHandler(dualEvent("mouseover","dojotouchover", "MSPointerOver")),
		leave: mouse._eventHandler(dualEvent("mouseout", "dojotouchout", "MSPointerOut"))
	};

	/*=====
	touch = {
		// summary:
		//		This module provides unified touch event handlers by exporting
		//		press, move, release and cancel which can also run well on desktop.
		//		Based on http://dvcs.w3.org/hg/webevents/raw-file/tip/touchevents.html
		//		Also, if the dojoClick property is set to true on a DOM node, dojo/touch generates
		//		click events immediately for this node and its descendants, to avoid the
		//		delay before native browser click events, and regardless of whether evt.preventDefault()
		//		was called in a touch.press event listener.
		//
		// example:
		//		Used with dojo.on
		//		|	define(["dojo/on", "dojo/touch"], function(on, touch){
		//		|		on(node, touch.press, function(e){});
		//		|		on(node, touch.move, function(e){});
		//		|		on(node, touch.release, function(e){});
		//		|		on(node, touch.cancel, function(e){});
		// example:
		//		Used with touch.* directly
		//		|	touch.press(node, function(e){});
		//		|	touch.move(node, function(e){});
		//		|	touch.release(node, function(e){});
		//		|	touch.cancel(node, function(e){});
		// example:
		//		Have dojo/touch generate clicks without delay, with a default move threshold of 4 pixels
		//		|	node.dojoClick = true;
		// example:
		//		Have dojo/touch generate clicks without delay, with a move threshold of 10 pixels horizontally and vertically
		//		|	node.dojoClick = 10;
		// example:
		//		Have dojo/touch generate clicks without delay, with a move threshold of 50 pixels horizontally and 10 pixels vertically
		//		|	node.dojoClick = {x:50, y:5};
		

		press: function(node, listener){
			// summary:
			//		Register a listener to 'touchstart'|'mousedown' for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		move: function(node, listener){
			// summary:
			//		Register a listener that fires when the mouse cursor or a finger is dragged over the given node.
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		release: function(node, listener){
			// summary:
			//		Register a listener to releasing the mouse button while the cursor is over the given node
			//		(i.e. "mouseup") or for removing the finger from the screen while touching the given node.
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		cancel: function(node, listener){
			// summary:
			//		Register a listener to 'touchcancel'|'mouseleave' for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		over: function(node, listener){
			// summary:
			//		Register a listener to 'mouseover' or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		out: function(node, listener){
			// summary:
			//		Register a listener to 'mouseout' or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		enter: function(node, listener){
			// summary:
			//		Register a listener to mouse.enter or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		},
		leave: function(node, listener){
			// summary:
			//		Register a listener to mouse.leave or touch equivalent for the given node
			// node: Dom
			//		Target node to listen to
			// listener: Function
			//		Callback function
			// returns:
			//		A handle which will be used to remove the listener by handle.remove()
		}
	};
	=====*/

	 1  && (dojo.touch = touch);

	return touch;
});

},
'dijit/registry':function(){
define([
	"dojo/_base/array", // array.forEach array.map
	"dojo/sniff", // has("ie")
	"dojo/_base/window", // win.body
	"./main"	// dijit._scopeName
], function(array, has, win, dijit){

	// module:
	//		dijit/registry

	var _widgetTypeCtr = {}, hash = {};

	var registry =  {
		// summary:
		//		Registry of existing widget on page, plus some utility methods.

		// length: Number
		//		Number of registered widgets
		length: 0,

		add: function(widget){
			// summary:
			//		Add a widget to the registry. If a duplicate ID is detected, a error is thrown.
			// widget: dijit/_WidgetBase
			//		Any dijit/_WidgetBase subclass.
			if(hash[widget.id]){
				throw new Error("Tried to register widget with id==" + widget.id + " but that id is already registered");
			}
			hash[widget.id] = widget;
			this.length++;
		},

		remove: function(/*String*/ id){
			// summary:
			//		Remove a widget from the registry. Does not destroy the widget; simply
			//		removes the reference.
			if(hash[id]){
				delete hash[id];
				this.length--;
			}
		},

		byId: function(/*String|Widget*/ id){
			// summary:
			//		Find a widget by it's id.
			//		If passed a widget then just returns the widget.
			return typeof id == "string" ? hash[id] : id;	// dijit/_WidgetBase
		},

		byNode: function(/*DOMNode*/ node){
			// summary:
			//		Returns the widget corresponding to the given DOMNode
			return hash[node.getAttribute("widgetId")]; // dijit/_WidgetBase
		},

		toArray: function(){
			// summary:
			//		Convert registry into a true Array
			//
			// example:
			//		Work with the widget .domNodes in a real Array
			//		|	array.map(registry.toArray(), function(w){ return w.domNode; });

			var ar = [];
			for(var id in hash){
				ar.push(hash[id]);
			}
			return ar;	// dijit/_WidgetBase[]
		},

		getUniqueId: function(/*String*/widgetType){
			// summary:
			//		Generates a unique id for a given widgetType

			var id;
			do{
				id = widgetType + "_" +
					(widgetType in _widgetTypeCtr ?
						++_widgetTypeCtr[widgetType] : _widgetTypeCtr[widgetType] = 0);
			}while(hash[id]);
			return dijit._scopeName == "dijit" ? id : dijit._scopeName + "_" + id; // String
		},

		findWidgets: function(root, skipNode){
			// summary:
			//		Search subtree under root returning widgets found.
			//		Doesn't search for nested widgets (ie, widgets inside other widgets).
			// root: DOMNode
			//		Node to search under.
			// skipNode: DOMNode
			//		If specified, don't search beneath this node (usually containerNode).

			var outAry = [];

			function getChildrenHelper(root){
				for(var node = root.firstChild; node; node = node.nextSibling){
					if(node.nodeType == 1){
						var widgetId = node.getAttribute("widgetId");
						if(widgetId){
							var widget = hash[widgetId];
							if(widget){	// may be null on page w/multiple dojo's loaded
								outAry.push(widget);
							}
						}else if(node !== skipNode){
							getChildrenHelper(node);
						}
					}
				}
			}

			getChildrenHelper(root);
			return outAry;
		},

		_destroyAll: function(){
			// summary:
			//		Code to destroy all widgets and do other cleanup on page unload

			// Clean up focus manager lingering references to widgets and nodes
			dijit._curFocus = null;
			dijit._prevFocus = null;
			dijit._activeStack = [];

			// Destroy all the widgets, top down
			array.forEach(registry.findWidgets(win.body()), function(widget){
				// Avoid double destroy of widgets like Menu that are attached to <body>
				// even though they are logically children of other widgets.
				if(!widget._destroyed){
					if(widget.destroyRecursive){
						widget.destroyRecursive();
					}else if(widget.destroy){
						widget.destroy();
					}
				}
			});
		},

		getEnclosingWidget: function(/*DOMNode*/ node){
			// summary:
			//		Returns the widget whose DOM tree contains the specified DOMNode, or null if
			//		the node is not contained within the DOM tree of any widget
			while(node){
				var id = node.nodeType == 1 && node.getAttribute("widgetId");
				if(id){
					return hash[id];
				}
				node = node.parentNode;
			}
			return null;
		},

		// In case someone needs to access hash.
		// Actually, this is accessed from WidgetSet back-compatibility code
		_hash: hash
	};

	dijit.registry = registry;

	return registry;
});

},
'dijit/main':function(){
define([
	"dojo/_base/kernel"
], function(dojo){
	// module:
	//		dijit/main

/*=====
return {
	// summary:
	//		The dijit package main module.
	//		Deprecated.   Users should access individual modules (ex: dijit/registry) directly.
};
=====*/

	return dojo.dijit;
});

},
'dojox/mobile/sniff':function(){
define([
	"dojo/_base/kernel",
	"dojo/sniff"
], function(kernel, has){

	kernel.deprecated("dojox/mobile/sniff", "Use dojo/sniff instead", "2.0");
	
	// TODO: remove this in 2.0
	has.add("iphone", has("ios"));

	/*=====
	return {
		// summary:
		//		Deprecated: use dojo/sniff instead.
		//		On iOS, dojox/mobile/sniff sets "iphone" to the same value as "ios"
		//		for compatibility with earlier versions, but this should be considered deprecated.
		//		In future versions, "iphone" will be set only when running on an iPhone (not iPad on iPod).
	};
	=====*/
	return has;
});

},
'dojox/mobile/uacss':function(){
define([
	"dojo/_base/kernel",
	"dojo/_base/lang",
	"dojo/_base/window",
	"./sniff"
], function(dojo, lang, win, has){
	var html = win.doc.documentElement;
	html.className = lang.trim(html.className + " " + [
		has('bb') ? "dj_bb" : "",
		has('android') ? "dj_android" : "",
		has("ios") ? "dj_ios" : "",
		has("ios") >= 6 ? "dj_ios6" : "",
		has("ios") ? "dj_iphone" : "",	// TODO: remove for 2.0
		has('ipod') ? "dj_ipod" : "",
		has('ipad') ? "dj_ipad" : "",
		has('ie') ? "dj_ie": ""
	].join(" ").replace(/ +/g," "));
	
	/*=====
	return {
		// summary:
		//		Requiring this module adds CSS classes to your document's `<html`> tag:
		//
		//		- "dj_android" when running on Android;
		//		- "dj_bb" when running on BlackBerry;
		//		- "dj_ios" when running on iPhone, iPad or iPod;
		//		- "dj_iphone" when running on iPhone, iPad or iPod (Note: will be changed in future versions to be set only on iPhone);
		//		- "dj_ipod" when running on iPod;
		//		- "dj_ipad" when running on iPad.
	};
	=====*/
	return dojo;
});

},
'dojox/mobile/deviceTheme':function(){
(typeof define === "undefined" ? function(deps, def) { def(); } : define)([
	"dojo/_base/config",
	"dojo/_base/lang",
	"dojo/_base/window",
	"require"
], function(config, lang, win, require){

	// module:
	//		dojox/mobile/deviceTheme

	var dm = lang && lang.getObject("dojox.mobile", true) || {};

	var DeviceTheme = function(){
		// summary:
		//		Automatic theme loader.
		// description:
		//		This module detects the user agent of the browser and loads the
		//		appropriate theme files. It can be enabled by simply including 
		//		the dojox/mobile/deviceTheme script in your application as follows:
		//
		//	|	<script src="dojox/mobile/deviceTheme.js"></script>
		//	|	<script src="dojo/dojo.js" data-dojo-config="parseOnLoad: true"></script>
		//
		//		Using the script tag as above is the recommended way to load the 
		//		deviceTheme. Trying to load it using the AMD loader can lead to styles 
		//		being applied too late, because the loading of the theme files would 
		//		be performed asynchronously by the browser, so you could not assume 
		//		that the loading has been completed when your widgets are initialized.
		//		However, loading deviceTheme using the script tag has the drawback that 
		//		deviceTheme.js cannot be included in a build.
		//
		//		You can also pass an additional query parameter string:
		//		theme={theme id} to force a specific theme through the browser
		//		URL input. The available theme ids are Android, Holodark (theme introduced in Android 3.0), 
		//		BlackBerry, Custom, iPhone, and iPad. The theme names are case-sensitive. If the given
		//		id does not match, the iPhone theme is used.
		//
		//	|	http://your.server.com/yourapp.html // automatic detection
		//	|	http://your.server.com/yourapp.html?theme=Android // forces Android theme
		//	|	http://your.server.com/yourapp.html?theme=Holodark // forces Holodark theme
		//	|	http://your.server.com/yourapp.html?theme=BlackBerry // forces Blackberry theme
		//	|	http://your.server.com/yourapp.html?theme=Custom // forces Custom theme
		//	|	http://your.server.com/yourapp.html?theme=iPhone // forces iPhone theme
		//	|	http://your.server.com/yourapp.html?theme=iPad // forces iPad theme
		//
		//		To simulate a particular device from the application code, the user agent
		//		can be forced by setting dojoConfig.mblUserAgent as follows:
		//
		//	|	<script src="dojox/mobile/deviceTheme.js" data-dojo-config="mblUserAgent: 'Holodark'"></script>
		//	|	<script src="dojo/dojo.js" data-dojo-config="parseOnLoad: true"></script>
		//
		//		By default, an all-in-one theme file (e.g. themes/iphone/iphone.css) is
		//		loaded. The all-in-one theme files contain style sheets for all the
		//		dojox/mobile widgets regardless of whether they are used in your
		//		application or not.
		//
		//		If you want to choose what theme files to load, you can specify them
		//		via dojoConfig or data-dojo-config as shown in the following example:
		//
		//	|	<script src="dojox/mobile/deviceTheme.js"
		//	|		data-dojo-config="mblThemeFiles:['base','Button']"></script>
		//	|	<script src="dojo/dojo.js" data-dojo-config="parseOnLoad: true"></script>
		//
		//		In the case of this example, if iphone is detected, for example, the
		//		following files will be loaded:
		//
		//	|	dojox/mobile/themes/iphone/base.css
		//	|	dojox/mobile/themes/iphone/Button.css
		//
		//		If you want to load style sheets for your own custom widgets, you can
		//		specify a package name along with a theme file name in an array.
		//
		//	|	['base',['com.acme','MyWidget']]
		//
		//		In this case, the following files will be loaded.
		//
		//	|	dojox/mobile/themes/iphone/base.css
		//	|	com/acme/themes/iphone/MyWidget.css
		//
		//		If you specify '@theme' as a theme file name, it will be replaced with
		//		the theme folder name (e.g. 'iphone'). For example,
		//
		//	|	['@theme',['com.acme','MyWidget']]
		//
		//		will load the following files:
		//
		//	|	dojox/mobile/themes/iphone/iphone.css
		//	|	com/acme/themes/iphone/MyWidget.css
		
		if(!win){
			win = window;
			win.doc = document;
			win._no_dojo_dm = dm;
		}
		config = config || win.mblConfig || {};
		var scripts = win.doc.getElementsByTagName("script");
		for(var i = 0; i < scripts.length; i++){
			var n = scripts[i];
			var src = n.getAttribute("src") || "";
			if(src.match(/\/deviceTheme\.js/i)){
				config.baseUrl = src.replace("deviceTheme\.js", "../../dojo/");
				var conf = (n.getAttribute("data-dojo-config") || n.getAttribute("djConfig"));
				if(conf){
					var obj = eval("({ " + conf + " })");
					for(var key in obj){
						config[key] = obj[key];
					}
				}
				break;
			}else if(src.match(/\/dojo\.js/i)){
				config.baseUrl = src.replace("dojo\.js", "");
				break;
			}
		}

		this.loadCssFile = function(/*String*/file){
			// summary:
			//		Loads the given CSS file programmatically.
			var link = win.doc.createElement("link");
			link.href = file;
			link.type = "text/css";
			link.rel = "stylesheet";
			var head = win.doc.getElementsByTagName('head')[0];
			head.insertBefore(link, head.firstChild);
			dm.loadedCssFiles.push(link);
		};

		this.toUrl = function(/*String*/path){
			// summary:
			//		A wrapper for require.toUrl to support non-dojo usage.
			return require ? require.toUrl(path) : config.baseUrl + "../" + path;
		};

		this.setDm = function(/*Object*/_dm){
			// summary:
			//		Replaces the dojox/mobile object.
			// description:
			//		When this module is loaded from a script tag, dm is a plain
			//		local object defined at the begining of this module.
			//		common.js will replace the local dm object with the
			//		real dojox/mobile object through this method.
			dm = _dm;
		};

		this.themeMap = config.themeMap || [
			// summary:
			//		A map of user-agents to theme files.
			// description:
			//		The first array element is a regexp pattern that matches the
			//		userAgent string.
			//
			//		The second array element is a theme folder name.
			//
			//		The third array element is an array of css file paths to load.
			//
			//		The matching is performed in the array order, and stops after the
			//		first match.
			[
				"Holodark",
				"holodark",
				[]
			],
			[
				"Android 3",
				"holodark",
				[]
			],
			[
				"Android 4",
				"holodark",
				[]
			],
			[
				"Android",
				"android",
				[]
			],
			[
				"BlackBerry",
				"blackberry",
				[]
			],
			[
				"BB10",
				"blackberry",
				[]
			],
			[
				"iPhone",
				"iphone",
				[]
			],
			[
				"iPad",
				"iphone",
				[this.toUrl("dojox/mobile/themes/iphone/ipad.css")]
			],
			[
				"MSIE 10",
				"windows",
				[]
			],
			[
				"WindowsPhone",
				"windows",
				[]
			],
			[
				"Custom",
				"custom",
				[]
			],
			[
				".*",
				"iphone",
				[]
			]
		];

		dm.loadedCssFiles = [];
		this.loadDeviceTheme = function(/*String?*/userAgent){
			// summary:
			//		Loads a device-specific theme according to the user-agent
			//		string.
			// description:
			//		This function is automatically called when this module is
			//		evaluated.
			var t = config.mblThemeFiles || dm.themeFiles || ["@theme"];
			var i, j;
			var m = this.themeMap;
			var ua = userAgent || config.mblUserAgent || (location.search.match(/theme=(\w+)/) ? RegExp.$1 : navigator.userAgent);
			for(i = 0; i < m.length; i++){
				if(ua.match(new RegExp(m[i][0]))){
					var theme = m[i][1];
					if(theme == "windows" && config.mblDisableWindowsTheme){
						continue;
					}
					var cls = win.doc.documentElement.className;
					cls = cls.replace(new RegExp(" *" + dm.currentTheme + "_theme"), "") + " " + theme + "_theme";
					win.doc.documentElement.className = cls;
					dm.currentTheme = theme;
					var files = [].concat(m[i][2]);
					for(j = 0; j < t.length; j++){ 
						var isArray = (t[j] instanceof Array || typeof t[j] == "array");
						var path;
						if(!isArray && t[j].indexOf('/') !== -1){
							path = t[j];
						}else{
							var pkg = isArray ? (t[j][0]||"").replace(/\./g, '/') : "dojox/mobile";
							var name = (isArray ? t[j][1] : t[j]).replace(/\./g, '/');
							var f = "themes/" + theme + "/" +
								(name === "@theme" ? theme : name) + ".css";
							path = pkg + "/" + f;
						}
						files.unshift(this.toUrl(path));
					}
					//remove old css files
					for(var k = 0; k < dm.loadedCssFiles.length; k++){
						var n = dm.loadedCssFiles[k];
						n.parentNode.removeChild(n);
					}
					dm.loadedCssFiles = [];
					for(j = 0; j < files.length; j++){
						// dojox.mobile mirroring support
						var cssFilePath = files[j].toString();
						if(config["dojo-bidi"] == true && cssFilePath.indexOf("_rtl") == -1){
							var rtlCssList = "android.css blackberry.css custom.css iphone.css holodark.css base.css Carousel.css ComboBox.css IconContainer.css IconMenu.css ListItem.css RoundRectCategory.css SpinWheel.css Switch.css TabBar.css ToggleButton.css ToolBarButton.css";
							var cssName = cssFilePath.substr(cssFilePath.lastIndexOf('/') + 1);
							if(rtlCssList.indexOf(cssName) != -1){
								this.loadCssFile(cssFilePath.replace(".css","_rtl.css"));
							}
						}
						this.loadCssFile(files[j].toString());
					}

					if(userAgent && dm.loadCompatCssFiles){
						dm.loadCompatCssFiles();
					}
					break;
				}
			}
		};
	};

	// Singleton.  (TODO: can we replace DeviceTheme class and singleton w/a simple hash of functions?)
	var deviceTheme = new DeviceTheme();

	deviceTheme.loadDeviceTheme();
	window.deviceTheme = dm.deviceTheme = deviceTheme;

	return deviceTheme;
});

},
'dojo/store/Memory':function(){
define(["../_base/declare", "./util/QueryResults", "./util/SimpleQueryEngine" /*=====, "./api/Store" =====*/],
function(declare, QueryResults, SimpleQueryEngine /*=====, Store =====*/){

// module:
//		dojo/store/Memory

// No base class, but for purposes of documentation, the base class is dojo/store/api/Store
var base = null;
/*===== base = Store; =====*/

return declare("dojo.store.Memory", base, {
	// summary:
	//		This is a basic in-memory object store. It implements dojo/store/api/Store.
	constructor: function(options){
		// summary:
		//		Creates a memory object store.
		// options: dojo/store/Memory
		//		This provides any configuration information that will be mixed into the store.
		//		This should generally include the data property to provide the starting set of data.
		for(var i in options){
			this[i] = options[i];
		}
		this.setData(this.data || []);
	},
	// data: Array
	//		The array of all the objects in the memory store
	data:null,

	// idProperty: String
	//		Indicates the property to use as the identity property. The values of this
	//		property should be unique.
	idProperty: "id",

	// index: Object
	//		An index of data indices into the data array by id
	index:null,

	// queryEngine: Function
	//		Defines the query engine to use for querying the data store
	queryEngine: SimpleQueryEngine,
	get: function(id){
		// summary:
		//		Retrieves an object by its identity
		// id: Number
		//		The identity to use to lookup the object
		// returns: Object
		//		The object in the store that matches the given id.
		return this.data[this.index[id]];
	},
	getIdentity: function(object){
		// summary:
		//		Returns an object's identity
		// object: Object
		//		The object to get the identity from
		// returns: Number
		return object[this.idProperty];
	},
	put: function(object, options){
		// summary:
		//		Stores an object
		// object: Object
		//		The object to store.
		// options: dojo/store/api/Store.PutDirectives?
		//		Additional metadata for storing the data.  Includes an "id"
		//		property if a specific id is to be used.
		// returns: Number
		var data = this.data,
			index = this.index,
			idProperty = this.idProperty;
		var id = object[idProperty] = (options && "id" in options) ? options.id : idProperty in object ? object[idProperty] : Math.random();
		if(id in index){
			// object exists
			if(options && options.overwrite === false){
				throw new Error("Object already exists");
			}
			// replace the entry in data
			data[index[id]] = object;
		}else{
			// add the new object
			index[id] = data.push(object) - 1;
		}
		return id;
	},
	add: function(object, options){
		// summary:
		//		Creates an object, throws an error if the object already exists
		// object: Object
		//		The object to store.
		// options: dojo/store/api/Store.PutDirectives?
		//		Additional metadata for storing the data.  Includes an "id"
		//		property if a specific id is to be used.
		// returns: Number
		(options = options || {}).overwrite = false;
		// call put with overwrite being false
		return this.put(object, options);
	},
	remove: function(id){
		// summary:
		//		Deletes an object by its identity
		// id: Number
		//		The identity to use to delete the object
		// returns: Boolean
		//		Returns true if an object was removed, falsy (undefined) if no object matched the id
		var index = this.index;
		var data = this.data;
		if(id in index){
			data.splice(index[id], 1);
			// now we have to reindex
			this.setData(data);
			return true;
		}
	},
	query: function(query, options){
		// summary:
		//		Queries the store for objects.
		// query: Object
		//		The query to use for retrieving objects from the store.
		// options: dojo/store/api/Store.QueryOptions?
		//		The optional arguments to apply to the resultset.
		// returns: dojo/store/api/Store.QueryResults
		//		The results of the query, extended with iterative methods.
		//
		// example:
		//		Given the following store:
		//
		// 	|	var store = new Memory({
		// 	|		data: [
		// 	|			{id: 1, name: "one", prime: false },
		//	|			{id: 2, name: "two", even: true, prime: true},
		//	|			{id: 3, name: "three", prime: true},
		//	|			{id: 4, name: "four", even: true, prime: false},
		//	|			{id: 5, name: "five", prime: true}
		//	|		]
		//	|	});
		//
		//	...find all items where "prime" is true:
		//
		//	|	var results = store.query({ prime: true });
		//
		//	...or find all items where "even" is true:
		//
		//	|	var results = store.query({ even: true });
		return QueryResults(this.queryEngine(query, options)(this.data));
	},
	setData: function(data){
		// summary:
		//		Sets the given data as the source for this store, and indexes it
		// data: Object[]
		//		An array of objects to use as the source of data.
		if(data.items){
			// just for convenience with the data format IFRS expects
			this.idProperty = data.identifier;
			data = this.data = data.items;
		}else{
			this.data = data;
		}
		this.index = {};
		for(var i = 0, l = data.length; i < l; i++){
			this.index[data[i][this.idProperty]] = i;
		}
	}
});

});

},
'dojo/store/util/QueryResults':function(){
define(["../../_base/array", "../../_base/lang", "../../when"
], function(array, lang, when){

// module:
//		dojo/store/util/QueryResults

var QueryResults = function(results){
	// summary:
	//		A function that wraps the results of a store query with additional
	//		methods.
	// description:
	//		QueryResults is a basic wrapper that allows for array-like iteration
	//		over any kind of returned data from a query.  While the simplest store
	//		will return a plain array of data, other stores may return deferreds or
	//		promises; this wrapper makes sure that *all* results can be treated
	//		the same.
	//
	//		Additional methods include `forEach`, `filter` and `map`.
	// results: Array|dojo/promise/Promise
	//		The result set as an array, or a promise for an array.
	// returns:
	//		An array-like object that can be used for iterating over.
	// example:
	//		Query a store and iterate over the results.
	//
	//	|	store.query({ prime: true }).forEach(function(item){
	//	|		//	do something
	//	|	});

	if(!results){
		return results;
	}
	// if it is a promise it may be frozen
	if(results.then){
		results = lang.delegate(results);
	}
	function addIterativeMethod(method){
		if(!results[method]){
			results[method] = function(){
				var args = arguments;
				return when(results, function(results){
					Array.prototype.unshift.call(args, results);
					return QueryResults(array[method].apply(array, args));
				});
			};
		}
	}
	addIterativeMethod("forEach");
	addIterativeMethod("filter");
	addIterativeMethod("map");
	if(!results.total){
		results.total = when(results, function(results){
			return results.length;
		});
	}
	return results; // Object
};

lang.setObject("dojo.store.util.QueryResults", QueryResults);

return QueryResults;

});

},
'dojo/store/util/SimpleQueryEngine':function(){
define(["../../_base/array" /*=====, "../api/Store" =====*/], function(arrayUtil /*=====, Store =====*/){

// module:
//		dojo/store/util/SimpleQueryEngine

return function(query, options){
	// summary:
	//		Simple query engine that matches using filter functions, named filter
	//		functions or objects by name-value on a query object hash
	//
	// description:
	//		The SimpleQueryEngine provides a way of getting a QueryResults through
	//		the use of a simple object hash as a filter.  The hash will be used to
	//		match properties on data objects with the corresponding value given. In
	//		other words, only exact matches will be returned.
	//
	//		This function can be used as a template for more complex query engines;
	//		for example, an engine can be created that accepts an object hash that
	//		contains filtering functions, or a string that gets evaluated, etc.
	//
	//		When creating a new dojo.store, simply set the store's queryEngine
	//		field as a reference to this function.
	//
	// query: Object
	//		An object hash with fields that may match fields of items in the store.
	//		Values in the hash will be compared by normal == operator, but regular expressions
	//		or any object that provides a test() method are also supported and can be
	//		used to match strings by more complex expressions
	//		(and then the regex's or object's test() method will be used to match values).
	//
	// options: dojo/store/api/Store.QueryOptions?
	//		An object that contains optional information such as sort, start, and count.
	//
	// returns: Function
	//		A function that caches the passed query under the field "matches".  See any
	//		of the "query" methods on dojo.stores.
	//
	// example:
	//		Define a store with a reference to this engine, and set up a query method.
	//
	//	|	var myStore = function(options){
	//	|		//	...more properties here
	//	|		this.queryEngine = SimpleQueryEngine;
	//	|		//	define our query method
	//	|		this.query = function(query, options){
	//	|			return QueryResults(this.queryEngine(query, options)(this.data));
	//	|		};
	//	|	};

	// create our matching query function
	switch(typeof query){
		default:
			throw new Error("Can not query with a " + typeof query);
		case "object": case "undefined":
			var queryObject = query;
			query = function(object){
				for(var key in queryObject){
					var required = queryObject[key];
					if(required && required.test){
						// an object can provide a test method, which makes it work with regex
						if(!required.test(object[key], object)){
							return false;
						}
					}else if(required != object[key]){
						return false;
					}
				}
				return true;
			};
			break;
		case "string":
			// named query
			if(!this[query]){
				throw new Error("No filter function " + query + " was found in store");
			}
			query = this[query];
			// fall through
		case "function":
			// fall through
	}
	function execute(array){
		// execute the whole query, first we filter
		var results = arrayUtil.filter(array, query);
		// next we sort
		var sortSet = options && options.sort;
		if(sortSet){
			results.sort(typeof sortSet == "function" ? sortSet : function(a, b){
				for(var sort, i=0; sort = sortSet[i]; i++){
					var aValue = a[sort.attribute];
					var bValue = b[sort.attribute];
					if (aValue != bValue){
						return !!sort.descending == (aValue == null || aValue > bValue) ? -1 : 1;
					}
				}
				return 0;
			});
		}
		// now we paginate
		if(options && (options.start || options.count)){
			var total = results.length;
			results = results.slice(options.start || 0, (options.start || 0) + (options.count || Infinity));
			results.total = total;
		}
		return results;
	}
	execute.matches = query;
	return execute;
};

});

},
'dojox/app/controllers/Load':function(){
define(["require", "dojo/_base/lang", "dojo/_base/declare", "dojo/on", "dojo/Deferred", "dojo/when", "../Controller"],
	function(require, lang, declare, on, Deferred, when, Controller, View){
	// module:
	//		dojox/app/controllers/Load
	// summary:
	//		Bind "app-load" event on dojox/app application instance.
	//		Load child view and sub children at one time.

	return declare("dojox.app.controllers.Load", Controller, {


		_waitingQueue:[],

		constructor: function(app, events){
			// summary:
			//		bind "app-load" event on application instance.
			//
			// app:
			//		dojox/app application instance.
			// events:
			//		{event : handler}
			this.events = {
				"app-init": this.init,
				"app-load": this.load
			};
		},

		init: function(event){
			// when the load controller received "app-init", before the lifecycle really starts we create the root view
			// if any. This used to be done in main.js but must be done in Load to be able to create custom
			// views from the Load controller.
			//create and start child. return Deferred
			when(this.createView(event.parent, null, null, {
					templateString: event.templateString,
					controller: event.controller
			}, null, event.type), function(newView){
				when(newView.start(), event.callback);
			});
		},

		load: function(event){
			// summary:
			//		Response to dojox/app "loadArray" event.
			//
			// example:
			//		Use trigger() to trigger "loadArray" event, and this function will response the event. For example:
			//		|	this.trigger("app-load", {"parent":parent, "viewId":viewId, "viewArray":viewArray, "callback":function(){...}});
			//
			// event: Object
			//		LoadArray event parameter. It should be like this: {"parent":parent, "viewId":viewId, "viewArray":viewArray, "callback":function(){...}}
			// returns:
			//		A dojo/Deferred object.
			//		The return value cannot return directly. 
			//		If the caller need to use the return value, pass callback function in event parameter and process return value in callback function.

			this.app.log("in app/controllers/Load event.viewId="+event.viewId+" event =", event);
			var views = event.viewId || "";
			var viewArray = [];
			// create an array from the diff views in event.viewId (they are separated by +)
			var parts = views.split('+');
			while(parts.length > 0){ 	
				var viewId = parts.shift();
				viewArray.push(viewId);
			}

			var def;
			this.proceedLoadViewDef = new Deferred();
			if(viewArray && viewArray.length > 1){
				// loop thru the array calling loadView for each item in the array
				for(var i = 0; i < viewArray.length-1; i++){
					var newEvent = lang.clone(event);
					newEvent.callback = null;	// skip callback until after last view is loaded.
					newEvent.viewId = viewArray[i];
					this._waitingQueue.push(newEvent);
				}
				this.proceedLoadView(this._waitingQueue.shift());
				when(this.proceedLoadViewDef, lang.hitch(this, function(){
					// for last view leave the callback to be notified
					var newEvent = lang.clone(event);
					newEvent.viewId = viewArray[i];
					def = this.loadView(newEvent);
					return def;
				}));
			}else{
				def = this.loadView(event);
				return def;
			}
		},
		
		proceedLoadView: function(loadEvt){
			// summary:
			//		Proceed load queue by FIFO by default.
			//		If load is in proceeding, add the next load to waiting queue.
			//
			// loadEvt: Object
			//		LoadArray event parameter. It should be like this: {"parent":parent, "viewId":viewId, "viewArray":viewArray, "callback":function(){...}}

			var def = this.loadView(loadEvt);
			when(def, lang.hitch(this, function(){
						this.app.log("in app/controllers/Load proceedLoadView back from loadView for event", loadEvt);
						var nextEvt = this._waitingQueue.shift();
						if(nextEvt){
							this.app.log("in app/controllers/Load proceedLoadView back from loadView calling this.proceedLoadView(nextEvt) for ",nextEvt);
							this.proceedLoadView(nextEvt);
						}else{
							this._waitingQueue = [];
							this.proceedLoadViewDef.resolve();
						}
			}));
		},

		loadView: function(event){
			// summary:
			//		Response to dojox/app "app-load" event.
			//
			// example:
			//		Use trigger() to trigger "app-load" event, and this function will response the event. For example:
			//		|	this.trigger("app-load", {"parent":parent, "viewId":viewId, "callback":function(){...}});
			//
			// event: Object
			//		Load event parameter. It should be like this: {"parent":parent, "viewId":viewId, "callback":function(){...}}
			// returns:
			//		A dojo/Deferred object.
			//		The return value cannot return directly. 
			//		If the caller need to use the return value, pass callback function in event parameter and process return value in callback function.

			var parent = event.parent || this.app;
			var viewId = event.viewId || "";
			var parts = viewId.split(',');
			var childId = parts.shift();
			var subIds = parts.join(",");
			var params = event.params || "";

			var def = this.loadChild(parent, childId, subIds, params);
			// call Load event callback
			if(event.callback){
				when(def, event.callback);
			}
			return def;
		},

		createChild: function(parent, childId, subIds, params){
			// summary:
			//		Create a view instance if not already loaded by calling createView. This is typically a
			//		dojox/app/View.
			//
			// parent: Object
			//		parent of the view.
			// childId: String
			//		view id need to be loaded.
			// subIds: String
			//		sub views' id of this view.
			// returns:
			//		If view exist, return the view object.
			//		Otherwise, create the view and return a dojo.Deferred instance.

			var id = parent.id + '_' + childId;
			
			// check for possible default params if no params were provided
			if(!params && parent.views[childId].defaultParams){
				params = parent.views[childId].defaultParams;
			}
			var view = parent.children[id];
			if(view){
				// set params to new value before returning
				if(params){
					view.params = params;
				}
				this.app.log("in app/controllers/Load createChild view is already loaded so return the loaded view with the new parms ",view);
				return view;
			}
			var def = new Deferred();
			// create and start child. return Deferred
			when(this.createView(parent, id, childId, null, params, parent.views[childId].type), function(newView){
				parent.children[id] = newView;
				when(newView.start(), function(view){
					def.resolve(view);
				});
			});
			return def;
		},

		createView: function(parent, id, name, mixin, params, type){
			// summary:
			//		Create a dojox/app/View instance. Can be overridden to create different type of views.
			// parent: Object
			//		parent of this view.
			// id: String
			//		view id.
			// name: String
			//		view name.
			// mixin: String
			//		additional property to be mixed into the view (templateString, controller...)
			// params: Object
			//		params of this view.
			// type: String
			//		the MID of the View. If not provided "dojox/app/View".
			// returns:
			//		A dojo/Deferred instance which will be resolved when the view will be instantiated.
			// tags:
			//		protected
			var def = new Deferred();
			var app = this.app;
			require([type?type:"../View"], function(View){
				var newView = new View(lang.mixin({
					"app": app,
					"id": id,
					"name": name,
					"parent": parent
				}, { "params": params }, mixin));
				def.resolve(newView);
			});
			return def;
		},

		loadChild: function(parent, childId, subIds, params){
			// summary:
			//		Load child and sub children views recursively.
			//
			// parent: Object
			//		parent of this view.
			// childId: String
			//		view id need to be loaded.
			// subIds: String
			//		sub views' id of this view.
			// params: Object
			//		params of this view.
			// returns:
			//		A dojo/Deferred instance which will be resolved when all views loaded.

			//TODO: Can this be called with a viewId or default view which includes multiple views with a "+"?  Need to handle that!

			if(!parent){
				throw Error("No parent for Child '" + childId + "'.");
			}

			if(!childId){
				var parts = parent.defaultView ? parent.defaultView.split(",") : "default";
				childId = parts.shift();
				subIds = parts.join(',');
			}

			var loadChildDeferred = new Deferred();
			var createPromise;
			try{
				createPromise = this.createChild(parent, childId, subIds, params);
			}catch(ex){
				loadChildDeferred.reject("load child '"+childId+"' error.");
				return loadChildDeferred.promise;
			}
			when(createPromise, lang.hitch(this, function(child){
				// if no subIds and current view has default view, load the default view.
				if(!subIds && child.defaultView){
					subIds = child.defaultView;
				}

				var parts = subIds.split(',');
				childId = parts.shift();
				subIds = parts.join(',');
				if(childId){
					var subLoadDeferred = this.loadChild(child, childId, subIds, params);
					when(subLoadDeferred, function(){
						loadChildDeferred.resolve();
					},
					function(){
						loadChildDeferred.reject("load child '"+childId+"' error.");
					});
				}else{
					loadChildDeferred.resolve();
				}
			}),
			function(){
				loadChildDeferred.reject("load child '"+childId+"' error.")
			});
			return loadChildDeferred.promise; // dojo/Deferred.promise
		}
	});
});

},
'dojox/app/controllers/Transition':function(){
define(["require", "dojo/_base/lang", "dojo/_base/declare", "dojo/has", "dojo/on", "dojo/Deferred", "dojo/when",
	"dojo/dom-style", "../Controller", "../utils/constraints"],
	function(require, lang, declare, has, on, Deferred, when, domStyle, Controller, constraints){

	var transit;

	// module:
	//		dojox/app/controllers/transition
	//		Bind "app-transition" event on dojox/app application instance.
	//		Do transition from one view to another view.
	return declare("dojox.app.controllers.Transition", Controller, {

		proceeding: false,

		waitingQueue:[],

		constructor: function(app, events){
			// summary:
			//		bind "app-transition" event on application instance.
			//
			// app:
			//		dojox/app application instance.
			// events:
			//		{event : handler}
			this.events = {
				"app-transition": this.transition,
				"app-domNode": this.onDomNodeChange
			};
			require([this.app.transit || "dojox/css3/transit"], function(t){
				transit = t;
			});
			if(this.app.domNode){
				this.onDomNodeChange({oldNode: null, newNode: this.app.domNode});
			}
		},

		transition: function(event){
			// summary:
			//		Response to dojox/app "app-transition" event.
			//
			// example:
			//		Use emit to trigger "app-transition" event, and this function will response to the event. For example:
			//		|	this.app.emit("app-transition", {"viewId": viewId, "opts": opts});
			//
			// event: Object
			//		"app-transition" event parameter. It should be like this: {"viewId": viewId, "opts": opts}
			
			var viewsId = event.viewId || "";
			this.proceedingSaved = this.proceeding;	
			var parts = viewsId.split('+');
			var viewId, newEvent;
			if(parts.length > 0){
				while(parts.length > 1){ 	
					viewId = parts.shift();
					newEvent = lang.clone(event);
					newEvent.viewId = viewId;
					this.proceeding = true;
					this.proceedTransition(newEvent);					
				}
				viewId = parts.shift();
				var removeParts = viewId.split('-');
				if(removeParts.length > 0){
					viewId = removeParts.shift();
					while(removeParts.length > 0){ 	
						var remViewId = removeParts.shift();
						newEvent = lang.clone(event);
						newEvent.viewId = remViewId;
						this._doTransition(newEvent.viewId, newEvent.opts, newEvent.opts.params, event.opts.data, this.app, true, newEvent._doResize);
					}
				}
				if(viewId.length > 0){ // check viewId.length > 0 to skip this section for a transition with only -viewId
					this.proceeding = this.proceedingSaved;
					event.viewId = viewId;	
					event._doResize = true; // at the end of the last transition call resize
					this.proceedTransition(event);
				}
			}else{
				event._doResize = true; // at the end of the last transition call resize
				this.proceedTransition(event);
			}
		},

		onDomNodeChange: function(evt){
			if(evt.oldNode != null){
				this.unbind(evt.oldNode, "startTransition");
			}
			this.bind(evt.newNode, "startTransition", lang.hitch(this, this.onStartTransition));
		},

		onStartTransition: function(evt){
			// summary:
			//		Response to dojox/app "startTransition" event.
			//
			// example:
			//		Use "dojox/mobile/TransitionEvent" to trigger "startTransition" event, and this function will response the event. For example:
			//		|	var transOpts = {
			//		|		title:"List",
			//		|		target:"items,list",
			//		|		url: "#items,list",
			//		|		data: {}
			//		|	};
			//		|	new TransitionEvent(domNode, transOpts, e).dispatch();
			//
			// evt: Object
			//		transition options parameter

			// prevent event from bubbling to window and being
			// processed by dojox/mobile/ViewController
			if(evt.preventDefault){
				evt.preventDefault();
			}
			evt.cancelBubble = true;
			if(evt.stopPropagation){
				evt.stopPropagation();
			}

			var target = evt.detail.target;
			var regex = /#(.+)/;
			if(!target && regex.test(evt.detail.href)){
				target = evt.detail.href.match(regex)[1];
			}

			// transition to the target view
			this.transition({ "viewId":target, opts: lang.mixin({}, evt.detail), data: evt.detail.data });
		},

		proceedTransition: function(transitionEvt){
			// summary:
			//		Proceed transition queue by FIFO by default.
			//		If transition is in proceeding, add the next transition to waiting queue.
			//
			// transitionEvt: Object
			//		"app-transition" event parameter. It should be like this: {"viewId":viewId, "opts":opts}

			if(this.proceeding){
				this.app.log("in app/controllers/Transition proceedTransition push event", transitionEvt);
				this.waitingQueue.push(transitionEvt);
				this.processingQueue = false;
				return;
			}
			// If there are events waiting, needed to have the last in be the last processed, so add it to waitingQueue
			// process the events in order.
			if(this.waitingQueue.length > 0 && !this.processingQueue){
				this.processingQueue = true;
				this.waitingQueue.push(transitionEvt);
				transitionEvt = this.waitingQueue.shift();	
			}
			
			this.proceeding = true;

			this.app.log("in app/controllers/Transition proceedTransition calling trigger load", transitionEvt);
			if(!transitionEvt.opts){
				transitionEvt.opts = {};
			}
			var params = transitionEvt.params || transitionEvt.opts.params;
			this.app.emit("app-load", {
				"viewId": transitionEvt.viewId,
				"params": params,
				"callback": lang.hitch(this, function(){
					var transitionDef = this._doTransition(transitionEvt.viewId, transitionEvt.opts, params, transitionEvt.opts.data, this.app, false, transitionEvt._doResize);
					when(transitionDef, lang.hitch(this, function(){
						this.proceeding = false;
						var nextEvt = this.waitingQueue.shift();
						if(nextEvt){
							this.proceedTransition(nextEvt);
						}
					}));
				})
			});
		},

		_getTransition: function(parent, transitionTo, opts){
			// summary:
			//		Get view's transition type from the config for the view or from the parent view recursively.
			//		If not available use the transition option otherwise get view default transition type in the
			//		config from parent view.
			//
			// parent: Object
			//		view's parent
			// transitionTo: Object
			//		view to transition to
			//	opts: Object
			//		transition options
			//
			// returns:
			//		transition type like "slide", "fade", "flip" or "none".
			var parentView = parent;
			var transition = null;
			if(parentView.views[transitionTo]){
				transition = parentView.views[transitionTo].transition;
			} 
			if(!transition){
				transition = parentView.transition;
			}
			var defaultTransition = parentView.defaultTransition;
			while(!transition && parentView.parent){
				parentView = parentView.parent;
				transition = parentView.transition;
				if(!defaultTransition){
					defaultTransition = parentView.defaultTransition;
				}
			}
			return transition || opts.transition || defaultTransition || "none";
		},


		_getParamsForView: function(view, params){
			// summary:
			//		Get view's params only include view specific params if they are for this view.
			//
			// view: String
			//		the view's name
			// params: Object
			//		the params
			//
			// returns:
			//		params Object for this view
			var viewParams = {};
			for(var item in params){
				var value = params[item];
				if(lang.isObject(value)){	// view specific params
					if(item == view){		// it is for this view
						// need to add these params for the view
						viewParams = lang.mixin(viewParams, value);
					} 
				}else{	// these params are for all views, so add them
					if(item && value != null){
						viewParams[item] = params[item];
					}
				}
			}
			return viewParams;
		},

		_doTransition: function(transitionTo, opts, params, data, parent, removeView, doResize, nested){
			// summary:
			//		Transitions from the currently visible scene to the defined scene.
			//		It should determine what would be the best transition unless
			//		an override in opts tells it to use a specific transitioning methodology
			//		the transitionTo is a string in the form of [view]@[scene].  If
			//		view is left of, the current scene will be transitioned to the default
			//		view of the specified scene (eg @scene2), if the scene is left off
			//		the app controller will instruct the active scene to the view (eg view1).  If both
			//		are supplied (view1@scene2), then the application should transition to the scene,
			//		and instruct the scene to navigate to the view.
			//
			// transitionTo: Object
			//		transition to view id. It looks like #tabScene,tab1
			// opts: Object
			//		transition options
			// params: Object
			//		params
			// data: Object
			//		data object that will be passed on activate & de-activate methods of the view
			// parent: Object
			//		view's parent
			// removeView: Boolean
			//		remove the view instead of transition to it
			// doResize: Boolean
			//		emit a resize event
			// nested: Boolean
			//		whether the method is called from the transitioning of a parent view
			//
			// returns:
			//		transit dojo/promise/all object.

			if(!parent){
				throw Error("view parent not found in transition.");
			}

			this.app.log("in app/controllers/Transition._doTransition transitionTo=[",transitionTo,"], removeView = [",removeView,"] parent.name=[",parent.name,"], opts=",opts);

			var parts, toId, subIds, next;
			if(transitionTo){
				parts = transitionTo.split(",");
			}else{
				// If parent.defaultView is like "main,main", we also need to split it and set the value to toId and subIds.
				// Or cannot get the next view by "parent.children[parent.id + '_' + toId]"
				parts = parent.defaultView.split(",");
			}
			toId = parts.shift();
			subIds = parts.join(',');

			// next is loaded and ready for transition
			next = parent.children[parent.id + '_' + toId];
			if(!next){
				if(removeView){
					this.app.log("> in Transition._doTransition called with removeView true, but that view is not available to remove");
					return;	// trying to remove a view which is not showing
				}
				throw Error("child view must be loaded before transition.");
			}

			var current = constraints.getSelectedChild(parent, next.constraint);

			// set params on next view.
			next.params = this._getParamsForView(next.name, params);

			// if no subIds and next has default view, 
			// set the subIds to the default view and transition to default view.
			if(!subIds && next.defaultView){
				subIds = next.defaultView;
			}

			if(removeView){
				if(next !== current){ // nothing to remove
					this.app.log("> in Transition._doTransition called with removeView true, but that view is not available to remove");
					return;	// trying to remove a view which is not showing
				}	
				// if next == current we will set next to null and remove the view with out a replacement
				next = null;
			}

			// next is not a Deferred object, so Deferred.when is no needed.
			if(next !== current){
				//When clicking fast, history module will cache the transition request que
				//and prevent the transition conflicts.
				//Originally when we conduct transition, selectedChild will not be the
				//view we want to start transition. For example, during transition 1 -> 2
				//if user click button to transition to 3 and then transition to 1. After
				//1->2 completes, it will perform transition 2 -> 3 and 2 -> 1 because
				//selectedChild is always point to 2 during 1 -> 2 transition and transition
				//will record 2->3 and 2->1 right after the button is clicked.

				//assume next is already loaded so that this.set(...) will not return
				//a promise object. this.set(...) will handles the this.selectedChild,
				//activate or deactivate views and refresh layout.

				// deactivate sub child of current view, then deactivate current view
				var selChildren = constraints.getAllSelectedChildren(current);
				for(var i = 0; i < selChildren.length; i++){					
					var subChild = selChildren[i];
					if(subChild && subChild.beforeDeactivate){ 
						this.app.log("< in Transition._doTransition calling subChild.beforeDeactivate subChild name=[",subChild.name,"], parent.name=[",subChild.parent.name,"], next!==current path");
						// TODO what to pass to beforeDeactivate here?
						subChild.beforeDeactivate();
					}
				}
				if(current){
					this.app.log("< in Transition._doTransition calling current.beforeDeactivate current name=[",current.name,"], parent.name=[",current.parent.name,"], next!==current path");
					current.beforeDeactivate(next, data);
				}
				if(next){
					this.app.log("> in Transition._doTransition calling next.beforeActivate next name=[",next.name,"], parent.name=[",next.parent.name,"], next!==current path");
					next.beforeActivate(current, data);
				}
				this.app.log("> in Transition._doTransition calling app.emit layoutView view next");
				if(!removeView){
					// if we are removing the view we must delay the layout to _after_ the animation
					this.app.emit("app-layoutView", {"parent": parent, "view": next });
				}
				if(doResize && !subIds){
					this.app.emit("app-resize"); // after last layoutView fire app-resize			
				}
				
				var result = true;
				if(transit && (!nested || current != null)){
					// css3 transit has the check for IE so it will not try to do it on ie, so we do not need to check it here.
					// We skip in we are transitioning to a nested view from a parent view and that nested view
					// did not have any current
					var mergedOpts = lang.mixin({}, opts); // handle reverse from mergedOpts or transitionDir
					mergedOpts = lang.mixin({}, mergedOpts, {
						reverse: (mergedOpts.reverse || mergedOpts.transitionDir === -1)?true:false,
						// if transition is set for the view (or parent) in the config use it, otherwise use it from the event or defaultTransition from the config
						transition: this._getTransition(parent, toId, mergedOpts)
					});
					if(next){
						this.app.log("    > in Transition._doTransition calling transit for current ="+next.name);
					}
					result = transit(current && current.domNode, next && next.domNode, mergedOpts);
				}
				when(result, lang.hitch(this, function(){
					if(next){
						this.app.log("    < in Transition._doTransition back from transit for next ="+next.name);
					}
					if(removeView){
						this.app.emit("app-layoutView", {"parent": parent, "view": current, "removeView": true});
					}

					// deactivate sub child of current view, then deactivate current view
					var selChildren = constraints.getAllSelectedChildren(current);
					for(var i = 0; i < selChildren.length; i++){					
						var subChild = selChildren[i];
						if(subChild && subChild.beforeDeactivate){ 
							this.app.log("  < in Transition._doTransition calling subChild.afterDeactivate subChild name=[",subChild.name,"], parent.name=[",subChild.parent.name,"], next!==current path");
							// TODO what  to pass to beforeDeactivate here?
							subChild.afterDeactivate();
						}
					}
					if(current){
						this.app.log("  < in Transition._doTransition calling current.afterDeactivate current name=[",current.name,"], parent.name=[",current.parent.name,"], next!==current path");
						current.afterDeactivate(next, data);
					}
					if(next){
						this.app.log("  > in Transition._doTransition calling next.afterActivate next name=[",next.name,"], parent.name=[",next.parent.name,"], next!==current path");
						next.afterActivate(current, data);
					}

					if(subIds){
						this._doTransition(subIds, opts, params, data, next || parent, removeView, doResize, true);
					}
				}));
				return result; // dojo/promise/all
			}

			// next view == current view, refresh current view
			// deactivate next view
			this.app.log("< in Transition._doTransition calling next.beforeDeactivate refresh current view next name=[",next.name,"], parent.name=[",next.parent.name,"], next==current path");
			next.beforeDeactivate(current, data);
			this.app.log("  < in Transition._doTransition calling next.afterDeactivate refresh current view next name=[",next.name,"], parent.name=[",next.parent.name,"], next==current path");
			next.afterDeactivate(current, data);
			// activate next view
			this.app.log("> in Transition._doTransition calling next.beforeActivate next name=[",next.name,"], parent.name=[",next.parent.name,"], next==current path");
			next.beforeActivate(current, data);
			// layout current view, or remove it
			this.app.log("> in Transition._doTransition calling app.triggger layoutView view next name=[",next.name,"], removeView = [",removeView,"], parent.name=[",next.parent.name,"], next==current path");
			this.app.emit("app-layoutView", {"parent":parent, "view": next, "removeView": removeView});
			if(doResize && !subIds){
				this.app.emit("app-resize"); // after last layoutView fire app-resize
			}
			this.app.log("  > in Transition._doTransition calling next.afterActivate next name=[",next.name,"], parent.name=[",next.parent.name,"], next==current path");
			next.afterActivate(current, data);

			// do sub transition like transition from "tabScene,tab1" to "tabScene,tab2"
			if(subIds){
				return this._doTransition(subIds, opts, params, data, next, removeView); //dojo.DeferredList
			}
		}
	});
});

},
'dojox/app/controllers/Layout':function(){
define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array", "dojo/_base/window",
		"dojo/query", "dojo/dom-geometry", "dojo/dom-attr", "dojo/dom-style", "dijit/registry",
		"./LayoutBase", "../utils/layout", "../utils/constraints"],
function(declare, lang, array, win, query, domGeom, domAttr, domStyle, registry, LayoutBase, layout, constraints){
	// module:
	//		dojox/app/controllers/Layout
	// summary:
	//		Extends LayoutBase which binds "app-initLayout", "app-layoutView" and "app-resize" events on application instance.

	return declare("dojox.app.controllers.Layout", LayoutBase, {

		constructor: function(app, events){
			// summary:
			//		bind "app-initLayout" and "app-layoutView" events on application instance.
			//
			// app:
			//		dojox/app application instance.
			// events:
			//		{event : handler}
		},

		onResize: function(){
			this._doResize(this.app);
			// this is needed to resize the children on an orientation change or a resize of the browser.
			// it was being done in _doResize, but was not needed for every call to _doResize.
			this.resizeSelectedChildren(this.app);
		},


		resizeSelectedChildren: function(w){
			for(var hash in w.selectedChildren){	// need this to handle all selectedChildren
				if(w.selectedChildren[hash]){
					this.app.log("in Layout resizeSelectedChildren calling resizeSelectedChildren calling _doResize for w.selectedChildren[hash].id="+w.selectedChildren[hash].id);
					this._doResize(w.selectedChildren[hash]);
					// Call resize on child widgets, needed to get the scrollableView to resize correctly initially	
					array.forEach(w.selectedChildren[hash].domNode.children, function(child){
						if(registry.byId(child.id) && registry.byId(child.id).resize){ 
							registry.byId(child.id).resize(); 
						}
					});	

					this.resizeSelectedChildren(w.selectedChildren[hash]);
				}
			}
		},

		initLayout: function(event){
			// summary:
			//		Response to dojox/app "app-initLayout" event.
			//
			// example:
			//		Use emit to trigger "app-initLayout" event, and this function will respond to the event. For example:
			//		|	this.app.emit("app-initLayout", view);
			//
			// event: Object
			// |		{"view": view, "callback": function(){}};
			this.app.log("in app/controllers/Layout.initLayout event=",event);
			this.app.log("in app/controllers/Layout.initLayout event.view.parent.name=[",event.view.parent.name,"]");

			event.view.parent.domNode.appendChild(event.view.domNode);

			domAttr.set(event.view.domNode, "data-app-constraint", event.view.constraint);

			this.inherited(arguments);
		},

		_doResize: function(view){
			// summary:
			//		resize view.
			//
			// view: Object
			//		view instance needs to do layout.
			var node = view.domNode;
			if(!node){
				this.app.log("Warning - View has not been loaded, in Layout _doResize view.domNode is not set for view.id="+view.id+" view=",view);
				return;
			}

			// If either height or width wasn't specified by the user, then query node for it.
			// But note that setting the margin box and then immediately querying dimensions may return
			// inaccurate results, so try not to depend on it.
			var mb = {};
			if( !("h" in mb) || !("w" in mb) ){
				mb = lang.mixin(domGeom.getMarginBox(node), mb);	// just use dojo/_base/html.marginBox() to fill in missing values
			}

			// Compute and save the size of my border box and content box
			// (w/out calling dojo/_base/html.contentBox() since that may fail if size was recently set)
			if(view !== this.app){
				var cs = domStyle.getComputedStyle(node);
				var me = domGeom.getMarginExtents(node, cs);
				var be = domGeom.getBorderExtents(node, cs);
				var bb = (view._borderBox = {
					w: mb.w - (me.w + be.w),
					h: mb.h - (me.h + be.h)
				});
				var pe = domGeom.getPadExtents(node, cs);
				view._contentBox = {
					l: domStyle.toPixelValue(node, cs.paddingLeft),
					t: domStyle.toPixelValue(node, cs.paddingTop),
					w: bb.w - pe.w,
					h: bb.h - pe.h
				};
			}else{
				// if we are layouting the top level app the above code does not work when hiding address bar
				// so let's use similar code to dojo mobile.
				view._contentBox = {
					l: 0,
					t: 0,
					h: win.global.innerHeight || win.doc.documentElement.clientHeight,
					w: win.global.innerWidth || win.doc.documentElement.clientWidth
				};
			}

			this.inherited(arguments);
		},

		layoutView: function(event){
			// summary:
			//		Response to dojox/app "app-layoutView" event.
			//
			// example:
			//		Use emit to trigger "app-layoutView" event, and this function will response the event. For example:
			//		|	this.app.emit("app-layoutView", view);
			//
			// event: Object
			// |		{"parent":parent, "view":view, "removeView": boolean}
			if(event.view){
				this.inherited(arguments);
				// do selected view layout
				// call _doResize for parent and view here, doResize will no longer call it for all children.
				this._doResize(event.parent || this.app);
				this._doResize(event.view);
			}
		},

		_doLayout: function(view){
			// summary:
			//		do view layout.
			//
			// view: Object
			//		view instance needs to do layout.

			if(!view){
				console.warn("layout empty view.");
				return;
			}
			this.app.log("in Layout _doLayout called for view.id="+view.id+" view=",view);

			var children;
			// TODO: probably need to handle selectedChildren here, not just selected child...
			// TODO: why are we passing view here? not parent? This call does not seem logical?
			var selectedChild = constraints.getSelectedChild(view, view.constraint);
			if(selectedChild && selectedChild.isFullScreen){
				console.warn("fullscreen sceen layout");
				/*
				 fullScreenScene=true;
				 children=[{domNode: selectedChild.domNode,constraint: "center"}];
				 query("> [constraint]",this.domNode).forEach(function(c){
				 if(selectedChild.domNode!==c.domNode){
				 dstyle(c.domNode,"display","none");
				 }
				 })
				 */
			}else{
				children = query("> [data-app-constraint]", view.domNode).map(function(node){
					var w = registry.getEnclosingWidget(node);
					if(w){
						w._constraint = domAttr.get(node, "data-app-constraint");
						return w;
					}

					return {
						domNode: node,
						_constraint: domAttr.get(node, "data-app-constraint")
					};
				});
				
				if(selectedChild){
					children = array.filter(children, function(c){
						// do not need to set display none here it is set in select.
						return c.domNode && c._constraint;
					}, view);
				}
			}
			// We don't need to layout children if this._contentBox is null for the operation will do nothing.
			if(view._contentBox){
				layout.layoutChildren(view.domNode, view._contentBox, children);
			}
		}
	});
});

},
'dojox/app/controllers/LayoutBase':function(){
define(["dojo/_base/lang", "dojo/_base/declare", "dojo/sniff", "dojo/_base/window", "dojo/_base/config",
		"dojo/dom-attr", "dojo/topic", "dojo/dom-style", "../utils/constraints", "../Controller"],
function(lang, declare, has, win, config, domAttr, topic, domStyle, constraints, Controller){
	// module:
	//		dojox/app/controllers/LayoutBase
	// summary:
	//		Bind "app-initLayout", "app-layoutView" and "app-resize" events on application instance.

	return declare("dojox.app.controllers.LayoutBase", Controller, {

		constructor: function(app, events){
			// summary:
			//		bind "app-initLayout", "app-layoutView" and "app-resize" events on application instance.
			//
			// app:
			//		dojox/app application instance.
			// events:
			//		{event : handler}
			this.events = {
				"app-initLayout": this.initLayout,
				"app-layoutView": this.layoutView,
				"app-resize": this.onResize
			};
			// if we are using dojo mobile & we are hiding address bar we need to be bit smarter and listen to
			// dojo mobile events instead
			if(config.mblHideAddressBar){
				topic.subscribe("/dojox/mobile/afterResizeAll", lang.hitch(this, this.onResize));
			}else{
				// bind to browsers orientationchange event for ios otherwise bind to browsers resize
				this.bind(win.global, has("ios") ? "orientationchange" : "resize", lang.hitch(this, this.onResize));
			}
		},

		onResize: function(){
			this._doResize(this.app);
			// this is needed to resize the children on an orientation change or a resize of the browser.
			// it was being done in _doResize, but was not needed for every call to _doResize.
			for(var hash in this.app.selectedChildren){	// need this to handle all selectedChildren
				if(this.app.selectedChildren[hash]){
					this._doResize(this.app.selectedChildren[hash]);
				}
			}
			
		},
		
		initLayout: function(event){
			// summary:
			//		Response to dojox/app "app-initLayout" event.
			//
			// example:
			//		Use emit to trigger "app-initLayout" event, and this function will respond to the event. For example:
			//		|	this.app.emit("app-initLayout", view);
			//
			// event: Object
			// |		{"view": view, "callback": function(){}};
			domAttr.set(event.view.domNode, "id", event.view.id);	// Set the id for the domNode
			if(event.callback){	// if the event has a callback, call it.
				event.callback();
			}
		},

		_doLayout: function(view){
			// summary:
			//		do view layout.
			//
			// view: Object
			//		view instance needs to do layout.

			if(!view){
				console.warn("layout empty view.");
			}
		},

		_doResize: function(view){
			// summary:
			//		resize view.
			//
			// view: Object
			//		view instance needs to do resize.
			this.app.log("in LayoutBase _doResize called for view.id="+view.id+" view=",view);
			this._doLayout(view);
		},

		layoutView: function(event){
			// summary:
			//		Response to dojox/app "app-layoutView" event.
			//
			// example:
			//		Use emit to trigger "app-layoutView" event, and this function will response the event. For example:
			//		|	this.app.emit("app-layoutView", view);
			//
			// event: Object
			// |		{"parent":parent, "view":view, "removeView": boolean}
			var parent = event.parent || this.app;
			var view = event.view;

			if(!view){
				return;
			}
			
			// if the parent has a child in the view constraint it has to be hidden, and this view displayed.
			var parentSelChild = constraints.getSelectedChild(parent, view.constraint);
			if(event.removeView){	// if this view is being removed set display to none and the selectedChildren entry to null
				view.viewShowing = false;
				this.hideView(view);
				if(view == parentSelChild){
					constraints.setSelectedChild(parent, view.constraint, null);	// remove from selectedChildren
				}
			}else if(view !== parentSelChild){
				if(parentSelChild){
				//	domStyle.set(parentSelChild.domNode, "zIndex", 25);
					parentSelChild.viewShowing = false;
					this.hideView(parentSelChild);
				}
				view.viewShowing = true;
				this.showView(view);
				//domStyle.set(view.domNode, "zIndex", 50);
				constraints.setSelectedChild(parent, view.constraint, view);
			}
		},

		hideView: function(view){
			domStyle.set(view.domNode, "display", "none");
		},

		showView: function(view){
			domStyle.set(view.domNode, "display", "");
		}
	});
});

},
'dojox/app/utils/layout':function(){
define([
	"dojo/_base/array", // array.filter array.forEach
	"dojo/dom-class", // domClass.add domClass.remove
	"dojo/dom-geometry", // domGeometry.marginBox
	"dojo/dom-style", // domStyle.getComputedStyle
	"dojo/_base/lang" // lang.mixin
], function(array, domClass, domGeometry, domStyle, lang){

	// module:
	//		dijit/layout/utils
	// summary:
	//		marginBox2contentBox() and layoutChildren()

	var layout = {};
	/*===== layout = dijit/layout =====*/

	layout.marginBox2contentBox = function(/*DomNode*/ node, /*Object*/ mb){
		// summary:
		//		Given the margin-box size of a node, return its content box size.
		//		Functions like domGeometry.contentBox() but is more reliable since it doesn't have
		//		to wait for the browser to compute sizes.
		var cs = domStyle.getComputedStyle(node);
		var me = domGeometry.getMarginExtents(node, cs);
		var pb = domGeometry.getPadBorderExtents(node, cs);
		return {
			l: domStyle.toPixelValue(node, cs.paddingLeft),
			t: domStyle.toPixelValue(node, cs.paddingTop),
			w: mb.w - (me.w + pb.w),
			h: mb.h - (me.h + pb.h)
		};
	};

	function capitalize(word){
		return word.substring(0,1).toUpperCase() + word.substring(1);
	}

	function size(widget, dim){
		// size the child
		var newSize = widget.resize ? widget.resize(dim) : domGeometry.setMarginBox(widget.domNode, dim);

		// record child's size
		if(newSize){
			// if the child returned it's new size then use that
			lang.mixin(widget, newSize);
		}else{
			// otherwise, call getMarginBox(), but favor our own numbers when we have them.
			// the browser lies sometimes
			lang.mixin(widget, domGeometry.getMarginBox(widget.domNode));
			lang.mixin(widget, dim);
		}
	}

	layout.layoutChildren = function(/*DomNode*/ container, /*Object*/ dim, /*Widget[]*/ children,
			/*String?*/ changedRegionId, /*Number?*/ changedRegionSize){
		// summary:
		//		Layout a bunch of child dom nodes within a parent dom node
		// container:
		//		parent node
		// dim:
		//		{l, t, w, h} object specifying dimensions of container into which to place children
		// children:
		//		An array of Widgets or at least objects containing:
		//
		//		- domNode: pointer to DOM node to position
		//		- constraint or layoutAlign: position to place DOM node
		//		- resize(): (optional) method to set size of node
		//		- id: (optional) Id of widgets, referenced from resize object, below.
		// changedRegionId:
		//		If specified, the slider for the region with the specified id has been dragged, and thus
		//		the region's height or width should be adjusted according to changedRegionSize
		// changedRegionSize:
		//		See changedRegionId.

		// copy dim because we are going to modify it
		dim = lang.mixin({}, dim);

		domClass.add(container, "dijitLayoutContainer");

		// Move "client" elements to the end of the array for layout.  a11y dictates that the author
		// needs to be able to put them in the document in tab-order, but this algorithm requires that
		// client be last.    TODO: move these lines to LayoutContainer?   Unneeded other places I think.
		children = array.filter(children, function(item){ return item._constraint != "center" && item.layoutAlign != "client"; })
			.concat(array.filter(children, function(item){ return item._constraint == "center" || item.layoutAlign == "client"; }));

		// set positions/sizes
		array.forEach(children, function(child){
			var elm = child.domNode,
				pos = (child._constraint || child.layoutAlign);
			if(!pos){
				throw new Error("No constraint setting for " + child.id)
			}

			// set elem to upper left corner of unused space; may move it later
			var elmStyle = elm.style;
			elmStyle.left = dim.l+"px";
			elmStyle.top = dim.t+"px";
			elmStyle.position = "absolute";

			domClass.add(elm, "dijitAlign" + capitalize(pos));

			// Size adjustments to make to this child widget
			var sizeSetting = {};

			// Check for optional size adjustment due to splitter drag (height adjustment for top/bottom align
			// panes and width adjustment for left/right align panes.
			if(changedRegionId && changedRegionId == child.id){
				sizeSetting[child._constraint == "top" || child._constraint == "bottom" ? "h" : "w"] = changedRegionSize;
			}

			// set size && adjust record of remaining space.
			// note that setting the width of a <div> may affect its height.
			if(pos == "top" || pos == "bottom"){
				sizeSetting.w = dim.w;
				size(child, sizeSetting);
				dim.h -= child.h;
				if(pos == "top"){
					dim.t += child.h;
				}else{
					elmStyle.top = dim.t + dim.h + "px";
				}
			}else if(pos == "left" || pos == "right"){
				sizeSetting.h = dim.h;
				size(child, sizeSetting);
				dim.w -= child.w;
				if(pos == "left"){
					dim.l += child.w;
				}else{
					elmStyle.left = dim.l + dim.w + "px";
				}
			}else if(pos == "client" || pos == "center"){
				size(child, dim);
			}
		});
	};


	return {
		marginBox2contentBox: layout.marginBox2contentBox,
		layoutChildren: layout.layoutChildren
	};
});

},
'dojox/css3/transit':function(){
define(["dojo/_base/array", "dojo/dom-style", "dojo/promise/all", "dojo/sniff", "./transition"],
	function(darray, domStyle, all, has, transition){
	// module: 
	//		dojox/css3/transit
	
	var transit = function(/*DomNode*/from, /*DomNode*/to, /*Object?*/options){
		// summary:
		//		Performs a transition to hide a node and show another node.
		// description:
		//		This module defines the transit method which is used
		//		to transit the specific region of an application from 
		//		one view/page to another view/page. This module relies 
		//		on utilities provided by dojox/css3/transition for the 
		//		transition effects.
		// options:
		//		The argument to specify the transit effect and direction.
		//		The effect can be specified in options.transition. The
		//		valid values are 'slide', 'flip', 'fade', 'none'.
		//		The direction can be specified in options.reverse. If it
		//		is true, the transit effects will be conducted in the
		//		reverse direction to the default direction. Finally the duration
		//		of the transition can be overridden by setting the duration property.
		var rev = (options && options.reverse) ? -1 : 1;
		if(!options || !options.transition || !transition[options.transition] || (has("ie") && has("ie") < 10)){
			if(from){
				domStyle.set(from,"display","none");
			}
			if(to){
				domStyle.set(to, "display", "");
			}
			if(options.transitionDefs){
				if(options.transitionDefs[from.id]){
					options.transitionDefs[from.id].resolve(from);
				}
				if(options.transitionDefs[to.id]){
					options.transitionDefs[to.id].resolve(to);
				}
			}
			// return any empty promise/all if the options.transition="none"
			return new all([]);
		}else{
			var defs = [];
			var transit = [];
			var duration = 2000;
			if(!options.duration){
				duration = 250;
				if(options.transition === "fade"){
					duration = 600;
				}else if (options.transition === "flip"){
					duration = 200;
				}
			}else{
				duration = options.duration;
			}
			if(from){
				domStyle.set(from, "display", "");
				//create transition to transit "from" out
				var fromTransit = transition[options.transition](from, {
					"in": false,
					direction: rev,
					duration: duration,
					deferred: (options.transitionDefs && options.transitionDefs[from.id]) ? options.transitionDefs[from.id] : null
				});
				defs.push(fromTransit.deferred);//every transition object should have a deferred.
				transit.push(fromTransit);
			}
			if(to){
				domStyle.set(to, "display", "");
				//create transition to transit "to" in
				var toTransit = transition[options.transition](to, {
								direction: rev,
								duration: duration,
								deferred: (options.transitionDefs && options.transitionDefs[to.id]) ? options.transitionDefs[to.id] : null
							});
				defs.push(toTransit.deferred);//every transition object should have a deferred.
				transit.push(toTransit);
			}
			//If it is flip use the chainedPlay, otherwise
			//play fromTransit and toTransit together
			if(options.transition === "flip"){
				transition.chainedPlay(transit);
			}else{
				transition.groupedPlay(transit);
			}

			return all(defs);
		}
	};
	
	return transit;
});

},
'dojox/css3/transition':function(){
define(["dojo/_base/lang",
		"dojo/_base/array",
		"dojo/Deferred",
		"dojo/when",
		"dojo/promise/all",
		"dojo/on",
		"dojo/sniff"],
		function(lang, array, Deferred, when, all, on, has){
	// module: 
	//		dojox/css3/transition
	
	//create cross platform animation/transition effects
	//TODO enable opera mobile when it is hardware accelerated
	// IE10 is using standard names so this is working without any modifications
	var transitionEndEventName = "transitionend";
	var transitionPrefix = "t"; //by default use "t" prefix and "ransition" to make word "transition"
	var translateMethodStart = "translate3d(";//Android 2.x does not support translateX in CSS Transition, we need to use translate3d in webkit browsers
	var translateMethodEnd = ",0,0)";
	if(has("webkit")){
		transitionPrefix = "WebkitT";
		transitionEndEventName = "webkitTransitionEnd";
	}else if(has("mozilla")){
		transitionPrefix = "MozT";
		translateMethodStart = "translateX(";
		translateMethodEnd = ")";
	}
	
	//TODO find a way to lock the animation and prevent animation conflict
	//Use the simple object inheritance
	var transition = function(/*Object?*/args){
		// summary:
		//		This module defines the transition utilities which can be used
		//		to perform transition effects based on the CSS Transition standard.
		// args:
		//		The arguments which will be mixed into this transition object.
		
		//default config should be in animation object itself instead of its prototype
		//otherwise, it might be easy for making mistake of modifying prototype
		var defaultConfig = {
				startState: {},
				endState: {},
				node: null,
				duration: 250,
				"in": true,
				direction: 1,
				autoClear: true
		};

		lang.mixin(this, defaultConfig);
		lang.mixin(this, args);

		//create the deferred object which will resolve after the animation is finished.
		//We can rely on "onAfterEnd" function to notify the end of a single animation,
		//but using a deferred object is easier to wait for multiple animations end.
		if(!this.deferred){
			this.deferred = new Deferred();
		}
	};
	
	lang.extend(transition, {
		
		play: function(){
			// summary:
			//		Plays the transition effect defined by this transition object.
			transition.groupedPlay([this]);
		},
		
		//method to apply the state of the transition
		_applyState: function(state){
			var style = this.node.style;
			for(var property in state){
				if(state.hasOwnProperty(property)){
					style[property] = state[property];
				}
			}
		},
		
		
		initState: function(){
			// summary:
			//		Method to initialize the state for a transition.
			
			//apply the immediate style change for initial state.
			this.node.style[transitionPrefix + "ransitionProperty"] = "none";
			this.node.style[transitionPrefix + "ransitionDuration"] = "0ms";
			this._applyState(this.startState);
			
		},
		
		_beforeStart: function(){
			if (this.node.style.display === "none"){
				this.node.style.display = "";
			}
			this.beforeStart();
		},
		
		_beforeClear: function(){
			this.node.style[transitionPrefix + "ransitionProperty"] = null;
			this.node.style[transitionPrefix + "ransitionDuration"] = null;
			if(this["in"] !== true){
				this.node.style.display = "none";
			}			 
			this.beforeClear();
		},
		
		_onAfterEnd: function(){
			this.deferred.resolve(this.node);
			if(this.node.id && transition.playing[this.node.id]===this.deferred){
				delete transition.playing[this.node.id];
			}
			this.onAfterEnd();
		},
		
		beforeStart: function(){
			// summary:
			//		The callback which will be called right before the start
			//		of the transition effect.
		},
		
		beforeClear: function(){
			// summary:
			//		The callback which will be called right after the end
			//		of the transition effect and before the final state is
			//		cleared.
		},
		
		onAfterEnd: function(){
			// summary:
			//		The callback which will be called right after the end
			//		of the transition effect and after the final state is
			//		cleared.
		},
		
		start: function(){
			// summary:
			//		Method to start the transition.
			this._beforeStart();
			this._startTime = new Date().getTime(); // set transition start timestamp
			this._cleared = false; // set clear flag to false

			var self = this;
			//change the transition duration
			self.node.style[transitionPrefix + "ransitionProperty"] = "all";
			self.node.style[transitionPrefix + "ransitionDuration"] = self.duration + "ms";
			
			//connect to clear the transition state after the transition end.
			//Since the transition is conducted asynchronously, we need to 
			//connect to transition end event to clear the state
			on.once(self.node, transitionEndEventName, function(){
				self.clear();
			});
			
			this._applyState(this.endState);
		},
		
		clear: function(){
			// summary:
			//		Method to clear the state after a transition.
			if(this._cleared) {
				return;
			}
			this._cleared = true; // set clear flag to true

			this._beforeClear();
			this._removeState(this.endState);
			// console.log(this.node.id + " clear.");
			this._onAfterEnd();
		},
		
		//create removeState method
		_removeState: function(state){
			var style = this.node.style;
			for(var property in state){
				if(state.hasOwnProperty(property)){
					style[property] = null;
				}
			}
		}
		
	});
	
	//TODO add the lock mechanism for all of the transition effects
	//	   consider using only one object for one type of transition.
	
	transition.slide = function(node, config){
		// summary:
		//		Method which is used to create the transition object of a slide effect.
		// node:
		//		The node that the slide transition effect will be applied on.
		// config:
		//		The cofig arguments which will be mixed into this transition object.

		//create the return object and set the startState, endState of the return
		var ret = new transition(config);
		ret.node = node;
		
		var startX = "0";
		var endX = "0";
		
		if(ret["in"]){
			if(ret.direction === 1){
				startX = "100%";
			}else{
				startX = "-100%";
			}
		}else{
			if(ret.direction === 1){
				endX = "-100%";
			}else{
				endX = "100%";
			}
		}
		
		ret.startState[transitionPrefix + "ransform"]=translateMethodStart+startX+translateMethodEnd;
		
		ret.endState[transitionPrefix + "ransform"]=translateMethodStart+endX+translateMethodEnd;
		
		return ret;
	};
		
	transition.fade = function(node, config){
		// summary:
		//		Method which is used to create the transition object of fade effect.
		// node:
		//		The node that the fade transition effect will be applied on.
		// config:
		//		The cofig arguments which will be mixed into this transition object.
		var ret = new transition(config);
		ret.node = node;
		
		var startOpacity = "0";
		var endOpacity = "0";
		
		if(ret["in"]){
			endOpacity = "1";
		}else{
			startOpacity = "1";
		}
		
		lang.mixin(ret, {
			startState:{
				"opacity": startOpacity
			},
			endState:{
				"opacity": endOpacity
			}
		});
		
		return ret;
	};
	
	transition.flip = function(node, config){
		// summary:
		//		Method which is used to create the transition object of flip effect.
		// node:
		//		The node that the flip transition effect will be applied on.
		// config:
		//		The cofig arguments which will be mixed into this transition object.
		
		var ret = new transition(config);
		ret.node = node;
	   
		if(ret["in"]){
			//Need to set opacity here because Android 2.2 has bug that
			//scale(...) in transform does not persist status
			lang.mixin(ret,{
				startState:{
					"opacity": "0"
				},
				endState:{
					"opacity": "1"
				}
			});
			ret.startState[transitionPrefix + "ransform"]="scale(0,0.8) skew(0,-30deg)";
			ret.endState[transitionPrefix + "ransform"]="scale(1,1) skew(0,0)";
		}else{
			lang.mixin(ret,{
				startState:{
					"opacity": "1"
				},
				endState:{
					"opacity": "0"
				}
			});			
			ret.startState[transitionPrefix + "ransform"]="scale(1,1) skew(0,0)";
			ret.endState[transitionPrefix + "ransform"]="scale(0,0.8) skew(0,30deg)";
		}
		
		return ret;
	};
	
	var getWaitingList = function(/*Array*/ nodes){
		var defs = [];
		array.forEach(nodes, function(node){
			//check whether the node is under other animation
			if(node.id && transition.playing[node.id]){
				//hook on deferred object in transition.playing
				defs.push(transition.playing[node.id]);
			}
			
		});
		return all(defs);
	};
	
	transition.getWaitingList = getWaitingList;
	
	transition.groupedPlay = function(/*Array*/args){
		// summary:
		//		The method which groups multiple transitions and plays 
		//		them together.
		// args: 
		//		The array of transition objects which will be played together.
		
		var animNodes = array.filter(args, function(item){
			return item.node;
		});
		
		var waitingList = getWaitingList(animNodes);

		//update registry with deferred objects in animations of args.
		array.forEach(args, function(item){
			if(item.node.id){
				transition.playing[item.node.id] = item.deferred;
			}
		});
		
		//wait for all deferred object in deferred list to resolve
		when(waitingList, function(){
			array.forEach(args, function(item){
				//set the start state
				item.initState();
			});
			
			//Assume the fps of the animation should be higher than 30 fps and
			//allow the browser to use one frame's time to redraw so that
			//the transition can be started
			setTimeout(function(){
				array.forEach(args, function(item){
					item.start();
				});

				// check and clear node if the node not cleared.
				// 1. on Android2.2/2.3, the "fade out" transitionEnd event will be lost if the soft keyboard popup, so we need to check nodes' clear status.
				// 2. The "fade in" transitionEnd event will before or after "fade out" transitionEnd event and it always occurs.
				//	  We can check fade out node status in the last "fade in" node transitionEnd event callback, if node transition timeout, we clear it.
				// NOTE: the last "fade in" transitionEnd event will always fired, so we bind on this event and check other nodes.
				on.once(args[args.length-1].node, transitionEndEventName, function(){
					var timeout;
					for(var i=0; i<args.length-1; i++){
						if(args[i].deferred.fired !== 0){
							timeout = new Date().getTime() - args[i]._startTime;
							if(timeout >= args[i].duration){
								args[i].clear();
							}
						}
					}
				});
			}, 33);
		});		   
	};
	
	transition.chainedPlay = function(/*Array*/args){
		// summary:
		//		The method which plays multiple transitions one by one.
		// args: 
		//		The array of transition objects which will be played in a chain.
		
		var animNodes = array.filter(args, function(item){
			return item.node;
		});
		
		var waitingList = getWaitingList(animNodes);

		//update registry with deferred objects in animations of args.
		array.forEach(args, function(item){
			if(item.node.id){
				transition.playing[item.node.id] = item.deferred;
			}
		});
		
		when(waitingList, function(){
			array.forEach(args, function(item){
				//set the start state
				item.initState();
			});
			
			//chain animations together
			for (var i=1, len=args.length; i < len; i++){
				args[i-1].deferred.then(lang.hitch(args[i], function(){
					this.start();
				}));
			}
			
			//Assume the fps of the animation should be higher than 30 fps and
			//allow the browser to use one frame's time to redraw so that
			//the transition can be started
			setTimeout(function(){
				args[0].start();
			}, 33);
		});		   
	};
	
	//TODO complete the registry mechanism for animation handling and prevent animation conflicts
	transition.playing = {};
	
	return transition;
});

},
'dojox/app/View':function(){
define(["require", "dojo/when", "dojo/on", "dojo/_base/declare", "dojo/_base/lang", "dojo/Deferred",
		"dijit/Destroyable", "dijit/_TemplatedMixin", "dijit/_WidgetsInTemplateMixin", "./ViewBase", "./utils/nls"],
	function(require, when, on, declare, lang, Deferred, Destroyable, _TemplatedMixin, _WidgetsInTemplateMixin, ViewBase, nls){

	return declare("dojox.app.View", [_TemplatedMixin, _WidgetsInTemplateMixin, Destroyable, ViewBase], {
		// summary:
		//		View class inheriting from ViewBase adding templating & globalization capabilities.
		constructor: function(params){
			// summary:
			//		Constructs a View instance either from a configuration or programmatically.
			//
			// example:
			//		|	use configuration file
			//		|
			// 		|	// load view controller from views/simple.js by default
			//		|	"simple":{
			//		|		"template": "myapp/views/simple.html",
			//		|		"nls": "myapp/nls/simple"
			//		|		"dependencies":["dojox/mobile/TextBox"]
			//		|	}
			//		|
			//		|	"home":{
			//		|		"template": "myapp/views/home.html", // no controller set to not use a view controller
			//		|		"dependencies":["dojox/mobile/TextBox"]
			//		|	}
			//		|	"main":{
			//		|		"template": "myapp/views/main.html",
			//		|		"controller": "myapp/views/main.js", // identify load view controller from views/main.js
			//		|		"dependencies":["dojox/mobile/TextBox"]
			//		|	}
			//
			// example:
			//		|	var viewObj = new View({
			//		|		app: this.app,
			//		|		id: this.id,
			//		|		name: this.name,
			//		|		parent: this,
			//		|		templateString: this.templateString,
			//		|		template: this.template, 
			//		|		controller: this.controller
			//		|	});
			//		|	viewObj.start(); // start view
			//
			// params:
			//		view parameters, include:
			//
			//		- app: the app
			//		- id: view id
			//		- name: view name
			//		- template: view template identifier. If templateString is not empty, this parameter is ignored.
			//		- templateString: view template string
			//		- controller: view controller module identifier
			//		- parent: parent view
			//		- children: children views
			//		- nls: nls definition module identifier
		},

		// _TemplatedMixin requires a connect method if data-dojo-attach-* are used
		connect: function(obj, event, method){
			return this.own(on(obj, event, lang.hitch(this, method)))[0]; // handle
		},

		_loadTemplate: function(){
			// summary:
			//		load view HTML template and dependencies.
			// tags:
			//		private
			//

			if(this.templateString){
				return true;
			}else{
				var tpl = this.template;
				var deps = this.dependencies?this.dependencies:[];
				if(tpl){
					if(tpl.indexOf("./") == 0){
						tpl = "app/"+tpl;
					}
					deps = deps.concat(["dojo/text!"+tpl]);
				}
				var def = new Deferred();
				if(deps.length > 0){
					var requireSignal;
					try{
						requireSignal = require.on("error", lang.hitch(this, function(error){
							if(def.isResolved() || def.isRejected()){
								return;
							}
							if(error.info[0] && error.info[0].indexOf(this.template) >= 0 ){
								def.resolve(false);
								requireSignal.remove();
							}
						}));
						require(deps, function(){
							def.resolve.call(def, arguments);
							requireSignal.remove();
						});
					}catch(e){
						def.resolve(false);
						if(requireSignal){
							requireSignal.remove();
						}
					}
				}else{
					def.resolve(true);
				}
				var loadViewDeferred = new Deferred();
				when(def, lang.hitch(this, function(){
					this.templateString = this.template ? arguments[0][arguments[0].length - 1] : "<div></div>";
					loadViewDeferred.resolve(this);
				}));
				return loadViewDeferred;
			}
		},

		// start view
		load: function(){
			var tplDef = new Deferred();
			var defDef = this.inherited(arguments);
			var nlsDef = nls(this);
			// when parent loading is done (controller), proceed with template
			// (for data-dojo-* to work we need to wait for controller to be here, this is also
			// useful when the controller is used as a layer for the view)
			when(defDef, lang.hitch(this, function(){
				when(nlsDef, lang.hitch(this, function(nls){
					// we inherit from the parent NLS
					this.nls = lang.mixin({}, this.parent.nls);
					if(nls){
						// make sure template can access nls doing ${nls.myprop}
						lang.mixin(this.nls, nls);
					}
					when(this._loadTemplate(), function(value){
						tplDef.resolve(value);
					});
				}));
			}));
			return tplDef;
		},

		_startup: function(){
			// summary:
			//		startup widgets in view template.
			// tags:
			//		private
			this.buildRendering();
			this.inherited(arguments);
		}
	});
});

},
'dijit/Destroyable':function(){
define([
	"dojo/_base/array", // array.forEach array.map
	"dojo/aspect",
	"dojo/_base/declare"
], function(array, aspect, declare){

	// module:
	//		dijit/Destroyable

	return declare("dijit.Destroyable", null, {
		// summary:
		//		Mixin to track handles and release them when instance is destroyed.
		// description:
		//		Call this.own(...) on list of handles (returned from dojo/aspect, dojo/on,
		//		dojo/Stateful::watch, or any class (including widgets) with a destroyRecursive() or destroy() method.
		//		Then call destroy() later to destroy this instance and release the resources.

		destroy: function(/*Boolean*/ preserveDom){
			// summary:
			//		Destroy this class, releasing any resources registered via own().
			this._destroyed = true;
		},

		own: function(){
			// summary:
			//		Track specified handles and remove/destroy them when this instance is destroyed, unless they were
			//		already removed/destroyed manually.
			// tags:
			//		protected
			// returns:
			//		The array of specified handles, so you can do for example:
			//	|		var handle = this.own(on(...))[0];

			array.forEach(arguments, function(handle){
				var destroyMethodName =
					"destroyRecursive" in handle ? "destroyRecursive" : // remove "destroyRecursive" for 2.0
						"destroy" in handle ? "destroy" :
							"remove";

				// When this.destroy() is called, destroy handle.  Since I'm using aspect.before(),
				// the handle will be destroyed before a subclass's destroy() method starts running, before it calls
				// this.inherited() or even if it doesn't call this.inherited() at all.  If that's an issue, make an
				// onDestroy() method and connect to that instead.
				var odh = aspect.before(this, "destroy", function(preserveDom){
					handle[destroyMethodName](preserveDom);
				});

				// If handle is destroyed manually before this.destroy() is called, remove the listener set directly above.
				var hdh = aspect.after(handle, destroyMethodName, function(){
					odh.remove();
					hdh.remove();
				}, true);
			}, this);

			return arguments;		// handle
		}
	});
});

},
'dijit/_TemplatedMixin':function(){
define([
	"dojo/cache",	// dojo.cache
	"dojo/_base/declare", // declare
	"dojo/dom-construct", // domConstruct.destroy, domConstruct.toDom
	"dojo/_base/lang", // lang.getObject
	"dojo/on",
	"dojo/sniff", // has("ie")
	"dojo/string", // string.substitute string.trim
	"./_AttachMixin"
], function(cache, declare, domConstruct, lang, on, has, string, _AttachMixin){

	// module:
	//		dijit/_TemplatedMixin

	var _TemplatedMixin = declare("dijit._TemplatedMixin", _AttachMixin, {
		// summary:
		//		Mixin for widgets that are instantiated from a template

		// templateString: [protected] String
		//		A string that represents the widget template.
		//		Use in conjunction with dojo.cache() to load from a file.
		templateString: null,

		// templatePath: [protected deprecated] String
		//		Path to template (HTML file) for this widget relative to dojo.baseUrl.
		//		Deprecated: use templateString with require([... "dojo/text!..."], ...) instead
		templatePath: null,

		// skipNodeCache: [protected] Boolean
		//		If using a cached widget template nodes poses issues for a
		//		particular widget class, it can set this property to ensure
		//		that its template is always re-built from a string
		_skipNodeCache: false,

/*=====
		// _rendered: Boolean
		//		Not normally use, but this flag can be set by the app if the server has already rendered the template,
		//		i.e. already inlining the template for the widget into the main page.   Reduces _TemplatedMixin to
		//		just function like _AttachMixin.
		_rendered: false,
=====*/

		// Set _AttachMixin.searchContainerNode to true for back-compat for widgets that have data-dojo-attach-point's
		// and events inside this.containerNode.   Remove for 2.0.
		searchContainerNode: true,

		_stringRepl: function(tmpl){
			// summary:
			//		Does substitution of ${foo} type properties in template string
			// tags:
			//		private
			var className = this.declaredClass, _this = this;
			// Cache contains a string because we need to do property replacement
			// do the property replacement
			return string.substitute(tmpl, this, function(value, key){
				if(key.charAt(0) == '!'){ value = lang.getObject(key.substr(1), false, _this); }
				if(typeof value == "undefined"){ throw new Error(className+" template:"+key); } // a debugging aide
				if(value == null){ return ""; }

				// Substitution keys beginning with ! will skip the transform step,
				// in case a user wishes to insert unescaped markup, e.g. ${!foo}
				return key.charAt(0) == "!" ? value :
					// Safer substitution, see heading "Attribute values" in
					// http://www.w3.org/TR/REC-html40/appendix/notes.html#h-B.3.2
					value.toString().replace(/"/g,"&quot;"); //TODO: add &amp? use encodeXML method?
			}, this);
		},

		buildRendering: function(){
			// summary:
			//		Construct the UI for this widget from a template, setting this.domNode.
			// tags:
			//		protected

			if(!this._rendered){
				if(!this.templateString){
					this.templateString = cache(this.templatePath, {sanitize: true});
				}

				// Lookup cached version of template, and download to cache if it
				// isn't there already.  Returns either a DomNode or a string, depending on
				// whether or not the template contains ${foo} replacement parameters.
				var cached = _TemplatedMixin.getCachedTemplate(this.templateString, this._skipNodeCache, this.ownerDocument);

				var node;
				if(lang.isString(cached)){
					node = domConstruct.toDom(this._stringRepl(cached), this.ownerDocument);
					if(node.nodeType != 1){
						// Flag common problems such as templates with multiple top level nodes (nodeType == 11)
						throw new Error("Invalid template: " + cached);
					}
				}else{
					// if it's a node, all we have to do is clone it
					node = cached.cloneNode(true);
				}

				this.domNode = node;
			}

			// Call down to _WidgetBase.buildRendering() to get base classes assigned
			// TODO: change the baseClass assignment to _setBaseClassAttr
			this.inherited(arguments);

			if(!this._rendered){
				this._fillContent(this.srcNodeRef);
			}

			this._rendered = true;
		},

		_fillContent: function(/*DomNode*/ source){
			// summary:
			//		Relocate source contents to templated container node.
			//		this.containerNode must be able to receive children, or exceptions will be thrown.
			// tags:
			//		protected
			var dest = this.containerNode;
			if(source && dest){
				while(source.hasChildNodes()){
					dest.appendChild(source.firstChild);
				}
			}
		}

	});

	// key is templateString; object is either string or DOM tree
	_TemplatedMixin._templateCache = {};

	_TemplatedMixin.getCachedTemplate = function(templateString, alwaysUseString, doc){
		// summary:
		//		Static method to get a template based on the templatePath or
		//		templateString key
		// templateString: String
		//		The template
		// alwaysUseString: Boolean
		//		Don't cache the DOM tree for this template, even if it doesn't have any variables
		// doc: Document?
		//		The target document.   Defaults to document global if unspecified.
		// returns: Mixed
		//		Either string (if there are ${} variables that need to be replaced) or just
		//		a DOM tree (if the node can be cloned directly)

		// is it already cached?
		var tmplts = _TemplatedMixin._templateCache;
		var key = templateString;
		var cached = tmplts[key];
		if(cached){
			try{
				// if the cached value is an innerHTML string (no ownerDocument) or a DOM tree created within the
				// current document, then use the current cached value
				if(!cached.ownerDocument || cached.ownerDocument == (doc || document)){
					// string or node of the same document
					return cached;
				}
			}catch(e){ /* squelch */ } // IE can throw an exception if cached.ownerDocument was reloaded
			domConstruct.destroy(cached);
		}

		templateString = string.trim(templateString);

		if(alwaysUseString || templateString.match(/\$\{([^\}]+)\}/g)){
			// there are variables in the template so all we can do is cache the string
			return (tmplts[key] = templateString); //String
		}else{
			// there are no variables in the template so we can cache the DOM tree
			var node = domConstruct.toDom(templateString, doc);
			if(node.nodeType != 1){
				throw new Error("Invalid template: " + templateString);
			}
			return (tmplts[key] = node); //Node
		}
	};

	if(has("ie")){
		on(window, "unload", function(){
			var cache = _TemplatedMixin._templateCache;
			for(var key in cache){
				var value = cache[key];
				if(typeof value == "object"){ // value is either a string or a DOM node template
					domConstruct.destroy(value);
				}
				delete cache[key];
			}
		});
	}

	return _TemplatedMixin;
});

},
'dojo/cache':function(){
define(["./_base/kernel", "./text"], function(dojo){
	// module:
	//		dojo/cache

	// dojo.cache is defined in dojo/text
	return dojo.cache;
});

},
'dojo/string':function(){
define([
	"./_base/kernel",	// kernel.global
	"./_base/lang"
], function(kernel, lang){

// module:
//		dojo/string

var string = {
	// summary:
	//		String utilities for Dojo
};
lang.setObject("dojo.string", string);

string.rep = function(/*String*/str, /*Integer*/num){
	// summary:
	//		Efficiently replicate a string `n` times.
	// str:
	//		the string to replicate
	// num:
	//		number of times to replicate the string

	if(num <= 0 || !str){ return ""; }

	var buf = [];
	for(;;){
		if(num & 1){
			buf.push(str);
		}
		if(!(num >>= 1)){ break; }
		str += str;
	}
	return buf.join("");	// String
};

string.pad = function(/*String*/text, /*Integer*/size, /*String?*/ch, /*Boolean?*/end){
	// summary:
	//		Pad a string to guarantee that it is at least `size` length by
	//		filling with the character `ch` at either the start or end of the
	//		string. Pads at the start, by default.
	// text:
	//		the string to pad
	// size:
	//		length to provide padding
	// ch:
	//		character to pad, defaults to '0'
	// end:
	//		adds padding at the end if true, otherwise pads at start
	// example:
	//	|	// Fill the string to length 10 with "+" characters on the right.  Yields "Dojo++++++".
	//	|	string.pad("Dojo", 10, "+", true);

	if(!ch){
		ch = '0';
	}
	var out = String(text),
		pad = string.rep(ch, Math.ceil((size - out.length) / ch.length));
	return end ? out + pad : pad + out;	// String
};

string.substitute = function(	/*String*/		template,
									/*Object|Array*/map,
									/*Function?*/	transform,
									/*Object?*/		thisObject){
	// summary:
	//		Performs parameterized substitutions on a string. Throws an
	//		exception if any parameter is unmatched.
	// template:
	//		a string with expressions in the form `${key}` to be replaced or
	//		`${key:format}` which specifies a format function. keys are case-sensitive.
	// map:
	//		hash to search for substitutions
	// transform:
	//		a function to process all parameters before substitution takes
	//		place, e.g. mylib.encodeXML
	// thisObject:
	//		where to look for optional format function; default to the global
	//		namespace
	// example:
	//		Substitutes two expressions in a string from an Array or Object
	//	|	// returns "File 'foo.html' is not found in directory '/temp'."
	//	|	// by providing substitution data in an Array
	//	|	string.substitute(
	//	|		"File '${0}' is not found in directory '${1}'.",
	//	|		["foo.html","/temp"]
	//	|	);
	//	|
	//	|	// also returns "File 'foo.html' is not found in directory '/temp'."
	//	|	// but provides substitution data in an Object structure.  Dotted
	//	|	// notation may be used to traverse the structure.
	//	|	string.substitute(
	//	|		"File '${name}' is not found in directory '${info.dir}'.",
	//	|		{ name: "foo.html", info: { dir: "/temp" } }
	//	|	);
	// example:
	//		Use a transform function to modify the values:
	//	|	// returns "file 'foo.html' is not found in directory '/temp'."
	//	|	string.substitute(
	//	|		"${0} is not found in ${1}.",
	//	|		["foo.html","/temp"],
	//	|		function(str){
	//	|			// try to figure out the type
	//	|			var prefix = (str.charAt(0) == "/") ? "directory": "file";
	//	|			return prefix + " '" + str + "'";
	//	|		}
	//	|	);
	// example:
	//		Use a formatter
	//	|	// returns "thinger -- howdy"
	//	|	string.substitute(
	//	|		"${0:postfix}", ["thinger"], null, {
	//	|			postfix: function(value, key){
	//	|				return value + " -- howdy";
	//	|			}
	//	|		}
	//	|	);

	thisObject = thisObject || kernel.global;
	transform = transform ?
		lang.hitch(thisObject, transform) : function(v){ return v; };

	return template.replace(/\$\{([^\s\:\}]+)(?:\:([^\s\:\}]+))?\}/g,
		function(match, key, format){
			var value = lang.getObject(key, false, map);
			if(format){
				value = lang.getObject(format, false, thisObject).call(thisObject, value, key);
			}
			return transform(value, key).toString();
		}); // String
};

string.trim = String.prototype.trim ?
	lang.trim : // aliasing to the native function
	function(str){
		str = str.replace(/^\s+/, '');
		for(var i = str.length - 1; i >= 0; i--){
			if(/\S/.test(str.charAt(i))){
				str = str.substring(0, i + 1);
				break;
			}
		}
		return str;
	};

/*=====
 string.trim = function(str){
	 // summary:
	 //		Trims whitespace from both sides of the string
	 // str: String
	 //		String to be trimmed
	 // returns: String
	 //		Returns the trimmed string
	 // description:
	 //		This version of trim() was taken from [Steven Levithan's blog](http://blog.stevenlevithan.com/archives/faster-trim-javascript).
	 //		The short yet performant version of this function is dojo.trim(),
	 //		which is part of Dojo base.  Uses String.prototype.trim instead, if available.
	 return "";	// String
 };
 =====*/

	return string;
});

},
'dijit/_AttachMixin':function(){
define([
	"require",
	"dojo/_base/array", // array.forEach
	"dojo/_base/connect",	// remove for 2.0
	"dojo/_base/declare", // declare
	"dojo/_base/lang", // lang.getObject
	"dojo/mouse",
	"dojo/on",
	"dojo/touch",
	"./_WidgetBase"
], function(require, array, connect, declare, lang, mouse, on, touch, _WidgetBase){

	// module:
	//		dijit/_AttachMixin

	// Map from string name like "mouseenter" to synthetic event like mouse.enter
	var synthEvents = lang.delegate(touch, {
		"mouseenter": mouse.enter,
		"mouseleave": mouse.leave,
		"keypress": connect._keypress	// remove for 2.0
	});

	// To be lightweight, _AttachMixin doesn't require() dijit/a11yclick.
	// If the subclass has a template using "ondijitclick", it must load dijit/a11yclick itself.
	// In that case, the a11yclick variable below will get set to point to that synthetic event.
	var a11yclick;

	var _AttachMixin = declare("dijit._AttachMixin", null, {
		// summary:
		//		Mixin for widgets to attach to dom nodes and setup events via
		//		convenient data-dojo-attach-point and data-dojo-attach-event DOM attributes.
		//
		//		Superclass of _TemplatedMixin, and can also be used standalone when templates are pre-rendered on the
		//		server.
		//
		//		Does not [yet] handle widgets like ContentPane with this.containerNode set.   It should skip
		//		scanning for data-dojo-attach-point and data-dojo-attach-event inside this.containerNode, but it
		//		doesn't.

/*=====
		// _attachPoints: [private] String[]
		//		List of widget attribute names associated with data-dojo-attach-point=... in the
		//		template, ex: ["containerNode", "labelNode"]
		_attachPoints: [],

		// _attachEvents: [private] Handle[]
		//		List of connections associated with data-dojo-attach-event=... in the
		//		template
		_attachEvents: [],

		// attachScope: [public] Object
		//		Object to which attach points and events will be scoped.  Defaults
		//		to 'this'.
		attachScope: undefined,

		// searchContainerNode: [protected] Boolean
		//		Search descendants of this.containerNode for data-dojo-attach-point and data-dojo-attach-event.
		//		Should generally be left false (the default value) both for performance and to avoid failures when
		//		this.containerNode holds other _AttachMixin instances with their own attach points and events.
 		searchContainerNode: false,
 =====*/

		constructor: function(/*===== params, srcNodeRef =====*/){
			// summary:
			//		Create the widget.
			// params: Object|null
			//		Hash of initialization parameters for widget, including scalar values (like title, duration etc.)
			//		and functions, typically callbacks like onClick.
			//		The hash can contain any of the widget's properties, excluding read-only properties.
			// srcNodeRef: DOMNode|String?
			//		If a srcNodeRef (DOM node) is specified, replace srcNodeRef with my generated DOM tree.

			this._attachPoints = [];
			this._attachEvents = [];
		},


		buildRendering: function(){
			// summary:
			//		Attach to DOM nodes marked with special attributes.
			// tags:
			//		protected

			this.inherited(arguments);

			// recurse through the node, looking for, and attaching to, our
			// attachment points and events, which should be defined on the template node.
			this._attachTemplateNodes(this.domNode);

			this._beforeFillContent();		// hook for _WidgetsInTemplateMixin
		},

		_beforeFillContent: function(){
		},

		_attachTemplateNodes: function(rootNode){
			// summary:
			//		Iterate through the dom nodes and attach functions and nodes accordingly.
			// description:
			//		Map widget properties and functions to the handlers specified in
			//		the dom node and it's descendants. This function iterates over all
			//		nodes and looks for these properties:
			//
			//		- dojoAttachPoint/data-dojo-attach-point
			//		- dojoAttachEvent/data-dojo-attach-event
			// rootNode: DomNode
			//		The node to search for properties. All descendants will be searched.
			// tags:
			//		private

			// DFS to process all nodes except those inside of this.containerNode
			var node = rootNode;
			while(true){
				if(node.nodeType == 1 && (this._processTemplateNode(node, function(n,p){ return n.getAttribute(p); },
						this._attach) || this.searchContainerNode) && node.firstChild){
					node = node.firstChild;
				}else{
					if(node == rootNode){ return; }
					while(!node.nextSibling){
						node = node.parentNode;
						if(node == rootNode){ return; }
					}
					node = node.nextSibling;
				}
			}
		},

		_processTemplateNode: function(/*DOMNode|Widget*/ baseNode, getAttrFunc, attachFunc){
			// summary:
			//		Process data-dojo-attach-point and data-dojo-attach-event for given node or widget.
			//		Returns true if caller should process baseNode's children too.

			var ret = true;

			// Process data-dojo-attach-point
			var _attachScope = this.attachScope || this,
				attachPoint = getAttrFunc(baseNode, "dojoAttachPoint") || getAttrFunc(baseNode, "data-dojo-attach-point");
			if(attachPoint){
				var point, points = attachPoint.split(/\s*,\s*/);
				while((point = points.shift())){
					if(lang.isArray(_attachScope[point])){
						_attachScope[point].push(baseNode);
					}else{
						_attachScope[point] = baseNode;
					}
					ret = (point != "containerNode");
					this._attachPoints.push(point);
				}
			}

			// Process data-dojo-attach-event
			var attachEvent = getAttrFunc(baseNode, "dojoAttachEvent") || getAttrFunc(baseNode, "data-dojo-attach-event");
			if(attachEvent){
				// NOTE: we want to support attributes that have the form
				// "domEvent: nativeEvent; ..."
				var event, events = attachEvent.split(/\s*,\s*/);
				var trim = lang.trim;
				while((event = events.shift())){
					if(event){
						var thisFunc = null;
						if(event.indexOf(":") != -1){
							// oh, if only JS had tuple assignment
							var funcNameArr = event.split(":");
							event = trim(funcNameArr[0]);
							thisFunc = trim(funcNameArr[1]);
						}else{
							event = trim(event);
						}
						if(!thisFunc){
							thisFunc = event;
						}

						this._attachEvents.push(attachFunc(baseNode, event, lang.hitch(_attachScope, thisFunc)));
					}
				}
			}

			return ret;
		},

		_attach: function(node, type, func){
			// summary:
			//		Roughly corresponding to dojo/on, this is the default function for processing a
			//		data-dojo-attach-event.  Meant to attach to DOMNodes, not to widgets.
			// node: DOMNode
			//		The node to setup a listener on.
			// type: String
			//		Event name like "click".
			// getAttrFunc: Function
			//		Function to get the specified property for a given DomNode/Widget.
			// attachFunc: Function?
			//		Attaches an event handler from the specified node/widget to specified function.

			// Map special type names like "mouseenter" to synthetic events.
			// Subclasses are responsible to require() dijit/a11yclick if they want to use it.
			type = type.replace(/^on/, "").toLowerCase();
			if(type == "dijitclick"){
				type = a11yclick || (a11yclick = require("./a11yclick"));
			}else{
				type = synthEvents[type] || type;
			}

			return on(node, type, func);
		},

		_detachTemplateNodes: function() {
			// summary:
			//		Detach and clean up the attachments made in _attachtempalteNodes.

			// Delete all attach points to prevent IE6 memory leaks.
			var _attachScope = this.attachScope || this;
			array.forEach(this._attachPoints, function(point){
				delete _attachScope[point];
			});
			this._attachPoints = [];

			// And same for event handlers
			array.forEach(this._attachEvents, function(handle){ handle.remove(); });
			this._attachEvents = [];
		},

		destroyRendering: function(){
			this._detachTemplateNodes();
			this.inherited(arguments);
		}
	});

	// These arguments can be specified for widgets which are used in templates.
	// Since any widget can be specified as sub widgets in template, mix it
	// into the base widget class.  (This is a hack, but it's effective.).
	// Remove for 2.0.   Also, hide from API doc parser.
	lang.extend(_WidgetBase, /*===== {} || =====*/ {
		dojoAttachEvent: "",
		dojoAttachPoint: ""
	});
	
	return _AttachMixin;
});

},
'dijit/_WidgetBase':function(){
define([
	"require", // require.toUrl
	"dojo/_base/array", // array.forEach array.map
	"dojo/aspect",
	"dojo/_base/config", // config.blankGif
	"dojo/_base/connect", // connect.connect
	"dojo/_base/declare", // declare
	"dojo/dom", // dom.byId
	"dojo/dom-attr", // domAttr.set domAttr.remove
	"dojo/dom-class", // domClass.add domClass.replace
	"dojo/dom-construct", // domConstruct.destroy domConstruct.place
	"dojo/dom-geometry", // isBodyLtr
	"dojo/dom-style", // domStyle.set, domStyle.get
	"dojo/has",
	"dojo/_base/kernel",
	"dojo/_base/lang", // mixin(), isArray(), etc.
	"dojo/on",
	"dojo/ready",
	"dojo/Stateful", // Stateful
	"dojo/topic",
	"dojo/_base/window", // win.body()
	"./Destroyable",
	"dojo/has!dojo-bidi?./_BidiMixin",
	"./registry"    // registry.getUniqueId(), registry.findWidgets()
], function(require, array, aspect, config, connect, declare,
			dom, domAttr, domClass, domConstruct, domGeometry, domStyle, has, kernel,
			lang, on, ready, Stateful, topic, win, Destroyable, _BidiMixin, registry){

	// module:
	//		dijit/_WidgetBase

	// Flag to make dijit load modules the app didn't explicitly request, for backwards compatibility
	has.add("dijit-legacy-requires", !kernel.isAsync);

	// Flag to enable support for textdir attribute
	has.add("dojo-bidi", false);


	// For back-compat, remove in 2.0.
	if(has("dijit-legacy-requires")){
		ready(0, function(){
			var requires = ["dijit/_base/manager"];
			require(requires);	// use indirection so modules not rolled into a build
		});
	}

	// Nested hash listing attributes for each tag, all strings in lowercase.
	// ex: {"div": {"style": true, "tabindex" true}, "form": { ...
	var tagAttrs = {};

	function getAttrs(obj){
		var ret = {};
		for(var attr in obj){
			ret[attr.toLowerCase()] = true;
		}
		return ret;
	}

	function nonEmptyAttrToDom(attr){
		// summary:
		//		Returns a setter function that copies the attribute to this.domNode,
		//		or removes the attribute from this.domNode, depending on whether the
		//		value is defined or not.
		return function(val){
			domAttr[val ? "set" : "remove"](this.domNode, attr, val);
			this._set(attr, val);
		};
	}

	var _WidgetBase = declare("dijit._WidgetBase", [Stateful, Destroyable], {
		// summary:
		//		Future base class for all Dijit widgets.
		// description:
		//		Future base class for all Dijit widgets.
		//		_Widget extends this class adding support for various features needed by desktop.
		//
		//		Provides stubs for widget lifecycle methods for subclasses to extend, like postMixInProperties(), buildRendering(),
		//		postCreate(), startup(), and destroy(), and also public API methods like set(), get(), and watch().
		//
		//		Widgets can provide custom setters/getters for widget attributes, which are called automatically by set(name, value).
		//		For an attribute XXX, define methods _setXXXAttr() and/or _getXXXAttr().
		//
		//		_setXXXAttr can also be a string/hash/array mapping from a widget attribute XXX to the widget's DOMNodes:
		//
		//		- DOM node attribute
		// |		_setFocusAttr: {node: "focusNode", type: "attribute"}
		// |		_setFocusAttr: "focusNode"	(shorthand)
		// |		_setFocusAttr: ""		(shorthand, maps to this.domNode)
		//		Maps this.focus to this.focusNode.focus, or (last example) this.domNode.focus
		//
		//		- DOM node innerHTML
		//	|		_setTitleAttr: { node: "titleNode", type: "innerHTML" }
		//		Maps this.title to this.titleNode.innerHTML
		//
		//		- DOM node innerText
		//	|		_setTitleAttr: { node: "titleNode", type: "innerText" }
		//		Maps this.title to this.titleNode.innerText
		//
		//		- DOM node CSS class
		// |		_setMyClassAttr: { node: "domNode", type: "class" }
		//		Maps this.myClass to this.domNode.className
		//
		//		If the value of _setXXXAttr is an array, then each element in the array matches one of the
		//		formats of the above list.
		//
		//		If the custom setter is null, no action is performed other than saving the new value
		//		in the widget (in this).
		//
		//		If no custom setter is defined for an attribute, then it will be copied
		//		to this.focusNode (if the widget defines a focusNode), or this.domNode otherwise.
		//		That's only done though for attributes that match DOMNode attributes (title,
		//		alt, aria-labelledby, etc.)

		// id: [const] String
		//		A unique, opaque ID string that can be assigned by users or by the
		//		system. If the developer passes an ID which is known not to be
		//		unique, the specified ID is ignored and the system-generated ID is
		//		used instead.
		id: "",
		_setIdAttr: "domNode", // to copy to this.domNode even for auto-generated id's

		// lang: [const] String
		//		Rarely used.  Overrides the default Dojo locale used to render this widget,
		//		as defined by the [HTML LANG](http://www.w3.org/TR/html401/struct/dirlang.html#adef-lang) attribute.
		//		Value must be among the list of locales specified during by the Dojo bootstrap,
		//		formatted according to [RFC 3066](http://www.ietf.org/rfc/rfc3066.txt) (like en-us).
		lang: "",
		// set on domNode even when there's a focus node.	but don't set lang="", since that's invalid.
		_setLangAttr: nonEmptyAttrToDom("lang"),

		// dir: [const] String
		//		Bi-directional support, as defined by the [HTML DIR](http://www.w3.org/TR/html401/struct/dirlang.html#adef-dir)
		//		attribute. Either left-to-right "ltr" or right-to-left "rtl".  If undefined, widgets renders in page's
		//		default direction.
		dir: "",
		// set on domNode even when there's a focus node.	but don't set dir="", since that's invalid.
		_setDirAttr: nonEmptyAttrToDom("dir"), // to set on domNode even when there's a focus node

		// class: String
		//		HTML class attribute
		"class": "",
		_setClassAttr: { node: "domNode", type: "class" },

		// style: String||Object
		//		HTML style attributes as cssText string or name/value hash
		style: "",

		// title: String
		//		HTML title attribute.
		//
		//		For form widgets this specifies a tooltip to display when hovering over
		//		the widget (just like the native HTML title attribute).
		//
		//		For TitlePane or for when this widget is a child of a TabContainer, AccordionContainer,
		//		etc., it's used to specify the tab label, accordion pane title, etc.  In this case it's
		//		interpreted as HTML.
		title: "",

		// tooltip: String
		//		When this widget's title attribute is used to for a tab label, accordion pane title, etc.,
		//		this specifies the tooltip to appear when the mouse is hovered over that text.
		tooltip: "",

		// baseClass: [protected] String
		//		Root CSS class of the widget (ex: dijitTextBox), used to construct CSS classes to indicate
		//		widget state.
		baseClass: "",

		// srcNodeRef: [readonly] DomNode
		//		pointer to original DOM node
		srcNodeRef: null,

		// domNode: [readonly] DomNode
		//		This is our visible representation of the widget! Other DOM
		//		Nodes may by assigned to other properties, usually through the
		//		template system's data-dojo-attach-point syntax, but the domNode
		//		property is the canonical "top level" node in widget UI.
		domNode: null,

		// containerNode: [readonly] DomNode
		//		Designates where children of the source DOM node will be placed.
		//		"Children" in this case refers to both DOM nodes and widgets.
		//		For example, for myWidget:
		//
		//		|	<div data-dojo-type=myWidget>
		//		|		<b> here's a plain DOM node
		//		|		<span data-dojo-type=subWidget>and a widget</span>
		//		|		<i> and another plain DOM node </i>
		//		|	</div>
		//
		//		containerNode would point to:
		//
		//		|		<b> here's a plain DOM node
		//		|		<span data-dojo-type=subWidget>and a widget</span>
		//		|		<i> and another plain DOM node </i>
		//
		//		In templated widgets, "containerNode" is set via a
		//		data-dojo-attach-point assignment.
		//
		//		containerNode must be defined for any widget that accepts innerHTML
		//		(like ContentPane or BorderContainer or even Button), and conversely
		//		is null for widgets that don't, like TextBox.
		containerNode: null,

		// ownerDocument: [const] Document?
		//		The document this widget belongs to.  If not specified to constructor, will default to
		//		srcNodeRef.ownerDocument, or if no sourceRef specified, then to the document global
		ownerDocument: null,
		_setOwnerDocumentAttr: function(val){
			// this setter is merely to avoid automatically trying to set this.domNode.ownerDocument
			this._set("ownerDocument", val);
		},

		/*=====
		// _started: [readonly] Boolean
		//		startup() has completed.
		_started: false,
		=====*/

		// attributeMap: [protected] Object
		//		Deprecated.	Instead of attributeMap, widget should have a _setXXXAttr attribute
		//		for each XXX attribute to be mapped to the DOM.
		//
		//		attributeMap sets up a "binding" between attributes (aka properties)
		//		of the widget and the widget's DOM.
		//		Changes to widget attributes listed in attributeMap will be
		//		reflected into the DOM.
		//
		//		For example, calling set('title', 'hello')
		//		on a TitlePane will automatically cause the TitlePane's DOM to update
		//		with the new title.
		//
		//		attributeMap is a hash where the key is an attribute of the widget,
		//		and the value reflects a binding to a:
		//
		//		- DOM node attribute
		// |		focus: {node: "focusNode", type: "attribute"}
		//		Maps this.focus to this.focusNode.focus
		//
		//		- DOM node innerHTML
		//	|		title: { node: "titleNode", type: "innerHTML" }
		//		Maps this.title to this.titleNode.innerHTML
		//
		//		- DOM node innerText
		//	|		title: { node: "titleNode", type: "innerText" }
		//		Maps this.title to this.titleNode.innerText
		//
		//		- DOM node CSS class
		// |		myClass: { node: "domNode", type: "class" }
		//		Maps this.myClass to this.domNode.className
		//
		//		If the value is an array, then each element in the array matches one of the
		//		formats of the above list.
		//
		//		There are also some shorthands for backwards compatibility:
		//
		//		- string --> { node: string, type: "attribute" }, for example:
		//
		//	|	"focusNode" ---> { node: "focusNode", type: "attribute" }
		//
		//		- "" --> { node: "domNode", type: "attribute" }
		attributeMap: {},

		// _blankGif: [protected] String
		//		Path to a blank 1x1 image.
		//		Used by `<img>` nodes in templates that really get their image via CSS background-image.
		_blankGif: config.blankGif || require.toUrl("dojo/resources/blank.gif"),

		//////////// INITIALIZATION METHODS ///////////////////////////////////////

		/*=====
		constructor: function(params, srcNodeRef){
			// summary:
			//		Create the widget.
			// params: Object|null
			//		Hash of initialization parameters for widget, including scalar values (like title, duration etc.)
			//		and functions, typically callbacks like onClick.
			//		The hash can contain any of the widget's properties, excluding read-only properties.
			// srcNodeRef: DOMNode|String?
			//		If a srcNodeRef (DOM node) is specified:
			//
			//		- use srcNodeRef.innerHTML as my contents
			//		- if this is a behavioral widget then apply behavior to that srcNodeRef
			//		- otherwise, replace srcNodeRef with my generated DOM tree
		},
		=====*/

		_introspect: function(){
			// summary:
			//		Collect metadata about this widget (only once per class, not once per instance):
			//
			//			- list of attributes with custom setters, storing in this.constructor._setterAttrs
			//			- generate this.constructor._onMap, mapping names like "mousedown" to functions like onMouseDown

			var ctor = this.constructor;
			if(!ctor._setterAttrs){
				var proto = ctor.prototype,
					attrs = ctor._setterAttrs = [], // attributes with custom setters
					onMap = (ctor._onMap = {});

				// Items in this.attributeMap are like custom setters.  For back-compat, remove for 2.0.
				for(var name in proto.attributeMap){
					attrs.push(name);
				}

				// Loop over widget properties, collecting properties with custom setters and filling in ctor._onMap.
				for(name in proto){
					if(/^on/.test(name)){
						onMap[name.substring(2).toLowerCase()] = name;
					}

					if(/^_set[A-Z](.*)Attr$/.test(name)){
						name = name.charAt(4).toLowerCase() + name.substr(5, name.length - 9);
						if(!proto.attributeMap || !(name in proto.attributeMap)){
							attrs.push(name);
						}
					}
				}

				// Note: this isn't picking up info on properties like aria-label and role, that don't have custom setters
				// but that set() maps to attributes on this.domNode or this.focusNode
			}
		},

		postscript: function(/*Object?*/params, /*DomNode|String*/srcNodeRef){
			// summary:
			//		Kicks off widget instantiation.  See create() for details.
			// tags:
			//		private

			// Note that we skip calling this.inherited(), i.e. dojo/Stateful::postscript(), because 1.x widgets don't
			// expect their custom setters to get called until after buildRendering().  Consider changing for 2.0.

			this.create(params, srcNodeRef);
		},

		create: function(params, srcNodeRef){
			// summary:
			//		Kick off the life-cycle of a widget
			// description:
			//		Create calls a number of widget methods (postMixInProperties, buildRendering, postCreate,
			//		etc.), some of which of you'll want to override. See http://dojotoolkit.org/reference-guide/dijit/_WidgetBase.html
			//		for a discussion of the widget creation lifecycle.
			//
			//		Of course, adventurous developers could override create entirely, but this should
			//		only be done as a last resort.
			// params: Object|null
			//		Hash of initialization parameters for widget, including scalar values (like title, duration etc.)
			//		and functions, typically callbacks like onClick.
			//		The hash can contain any of the widget's properties, excluding read-only properties.
			// srcNodeRef: DOMNode|String?
			//		If a srcNodeRef (DOM node) is specified:
			//
			//		- use srcNodeRef.innerHTML as my contents
			//		- if this is a behavioral widget then apply behavior to that srcNodeRef
			//		- otherwise, replace srcNodeRef with my generated DOM tree
			// tags:
			//		private

			// First time widget is instantiated, scan prototype to figure out info about custom setters etc.
			this._introspect();

			// store pointer to original DOM tree
			this.srcNodeRef = dom.byId(srcNodeRef);

			// No longer used, remove for 2.0.
			this._connects = [];
			this._supportingWidgets = [];

			// this is here for back-compat, remove in 2.0 (but check NodeList-instantiate.html test)
			if(this.srcNodeRef && (typeof this.srcNodeRef.id == "string")){
				this.id = this.srcNodeRef.id;
			}

			// mix in our passed parameters
			if(params){
				this.params = params;
				lang.mixin(this, params);
			}
			this.postMixInProperties();

			// Generate an id for the widget if one wasn't specified, or it was specified as id: undefined.
			// Do this before buildRendering() because it might expect the id to be there.
			if(!this.id){
				this.id = registry.getUniqueId(this.declaredClass.replace(/\./g, "_"));
				if(this.params){
					// if params contains {id: undefined}, prevent _applyAttributes() from processing it
					delete this.params.id;
				}
			}

			// The document and <body> node this widget is associated with
			this.ownerDocument = this.ownerDocument || (this.srcNodeRef ? this.srcNodeRef.ownerDocument : document);
			this.ownerDocumentBody = win.body(this.ownerDocument);

			registry.add(this);

			this.buildRendering();

			var deleteSrcNodeRef;

			if(this.domNode){
				// Copy attributes listed in attributeMap into the [newly created] DOM for the widget.
				// Also calls custom setters for all attributes with custom setters.
				this._applyAttributes();

				// If srcNodeRef was specified, then swap out original srcNode for this widget's DOM tree.
				// For 2.0, move this after postCreate().  postCreate() shouldn't depend on the
				// widget being attached to the DOM since it isn't when a widget is created programmatically like
				// new MyWidget({}).	See #11635.
				var source = this.srcNodeRef;
				if(source && source.parentNode && this.domNode !== source){
					source.parentNode.replaceChild(this.domNode, source);
					deleteSrcNodeRef = true;
				}

				// Note: for 2.0 may want to rename widgetId to dojo._scopeName + "_widgetId",
				// assuming that dojo._scopeName even exists in 2.0
				this.domNode.setAttribute("widgetId", this.id);
			}
			this.postCreate();

			// If srcNodeRef has been processed and removed from the DOM (e.g. TemplatedWidget) then delete it to allow GC.
			// I think for back-compatibility it isn't deleting srcNodeRef until after postCreate() has run.
			if(deleteSrcNodeRef){
				delete this.srcNodeRef;
			}

			this._created = true;
		},

		_applyAttributes: function(){
			// summary:
			//		Step during widget creation to copy  widget attributes to the
			//		DOM according to attributeMap and _setXXXAttr objects, and also to call
			//		custom _setXXXAttr() methods.
			//
			//		Skips over blank/false attribute values, unless they were explicitly specified
			//		as parameters to the widget, since those are the default anyway,
			//		and setting tabIndex="" is different than not setting tabIndex at all.
			//
			//		For backwards-compatibility reasons attributeMap overrides _setXXXAttr when
			//		_setXXXAttr is a hash/string/array, but _setXXXAttr as a functions override attributeMap.
			// tags:
			//		private

			// Call this.set() for each property that was either specified as parameter to constructor,
			// or is in the list found above.	For correlated properties like value and displayedValue, the one
			// specified as a parameter should take precedence.
			// Particularly important for new DateTextBox({displayedValue: ...}) since DateTextBox's default value is
			// NaN and thus is not ignored like a default value of "".

			// Step 1: Save the current values of the widget properties that were specified as parameters to the constructor.
			// Generally this.foo == this.params.foo, except if postMixInProperties() changed the value of this.foo.
			var params = {};
			for(var key in this.params || {}){
				params[key] = this._get(key);
			}

			// Step 2: Call set() for each property with a non-falsy value that wasn't passed as a parameter to the constructor
			array.forEach(this.constructor._setterAttrs, function(key){
				if(!(key in params)){
					var val = this._get(key);
					if(val){
						this.set(key, val);
					}
				}
			}, this);

			// Step 3: Call set() for each property that was specified as parameter to constructor.
			// Use params hash created above to ignore side effects from step #2 above.
			for(key in params){
				this.set(key, params[key]);
			}
		},

		postMixInProperties: function(){
			// summary:
			//		Called after the parameters to the widget have been read-in,
			//		but before the widget template is instantiated. Especially
			//		useful to set properties that are referenced in the widget
			//		template.
			// tags:
			//		protected
		},

		buildRendering: function(){
			// summary:
			//		Construct the UI for this widget, setting this.domNode.
			//		Most widgets will mixin `dijit._TemplatedMixin`, which implements this method.
			// tags:
			//		protected

			if(!this.domNode){
				// Create root node if it wasn't created by _TemplatedMixin
				this.domNode = this.srcNodeRef || this.ownerDocument.createElement("div");
			}

			// baseClass is a single class name or occasionally a space-separated list of names.
			// Add those classes to the DOMNode.  If RTL mode then also add with Rtl suffix.
			// TODO: make baseClass custom setter
			if(this.baseClass){
				var classes = this.baseClass.split(" ");
				if(!this.isLeftToRight()){
					classes = classes.concat(array.map(classes, function(name){
						return name + "Rtl";
					}));
				}
				domClass.add(this.domNode, classes);
			}
		},

		postCreate: function(){
			// summary:
			//		Processing after the DOM fragment is created
			// description:
			//		Called after the DOM fragment has been created, but not necessarily
			//		added to the document.  Do not include any operations which rely on
			//		node dimensions or placement.
			// tags:
			//		protected
		},

		startup: function(){
			// summary:
			//		Processing after the DOM fragment is added to the document
			// description:
			//		Called after a widget and its children have been created and added to the page,
			//		and all related widgets have finished their create() cycle, up through postCreate().
			//
			//		Note that startup() may be called while the widget is still hidden, for example if the widget is
			//		inside a hidden dijit/Dialog or an unselected tab of a dijit/layout/TabContainer.
			//		For widgets that need to do layout, it's best to put that layout code inside resize(), and then
			//		extend dijit/layout/_LayoutWidget so that resize() is called when the widget is visible.
			if(this._started){
				return;
			}
			this._started = true;
			array.forEach(this.getChildren(), function(obj){
				if(!obj._started && !obj._destroyed && lang.isFunction(obj.startup)){
					obj.startup();
					obj._started = true;
				}
			});
		},

		//////////// DESTROY FUNCTIONS ////////////////////////////////

		destroyRecursive: function(/*Boolean?*/ preserveDom){
			// summary:
			//		Destroy this widget and its descendants
			// description:
			//		This is the generic "destructor" function that all widget users
			//		should call to cleanly discard with a widget. Once a widget is
			//		destroyed, it is removed from the manager object.
			// preserveDom:
			//		If true, this method will leave the original DOM structure
			//		alone of descendant Widgets. Note: This will NOT work with
			//		dijit._TemplatedMixin widgets.

			this._beingDestroyed = true;
			this.destroyDescendants(preserveDom);
			this.destroy(preserveDom);
		},

		destroy: function(/*Boolean*/ preserveDom){
			// summary:
			//		Destroy this widget, but not its descendants.  Descendants means widgets inside of
			//		this.containerNode.   Will also destroy any resources (including widgets) registered via this.own().
			//
			//		This method will also destroy internal widgets such as those created from a template,
			//		assuming those widgets exist inside of this.domNode but outside of this.containerNode.
			//
			//		For 2.0 it's planned that this method will also destroy descendant widgets, so apps should not
			//		depend on the current ability to destroy a widget without destroying its descendants.   Generally
			//		they should use destroyRecursive() for widgets with children.
			// preserveDom: Boolean
			//		If true, this method will leave the original DOM structure alone.
			//		Note: This will not yet work with _TemplatedMixin widgets

			this._beingDestroyed = true;
			this.uninitialize();

			function destroy(w){
				if(w.destroyRecursive){
					w.destroyRecursive(preserveDom);
				}else if(w.destroy){
					w.destroy(preserveDom);
				}
			}

			// Back-compat, remove for 2.0
			array.forEach(this._connects, lang.hitch(this, "disconnect"));
			array.forEach(this._supportingWidgets, destroy);

			// Destroy supporting widgets, but not child widgets under this.containerNode (for 2.0, destroy child widgets
			// here too).   if() statement is to guard against exception if destroy() called multiple times (see #15815).
			if(this.domNode){
				array.forEach(registry.findWidgets(this.domNode, this.containerNode), destroy);
			}

			this.destroyRendering(preserveDom);
			registry.remove(this.id);
			this._destroyed = true;
		},

		destroyRendering: function(/*Boolean?*/ preserveDom){
			// summary:
			//		Destroys the DOM nodes associated with this widget.
			// preserveDom:
			//		If true, this method will leave the original DOM structure alone
			//		during tear-down. Note: this will not work with _Templated
			//		widgets yet.
			// tags:
			//		protected

			if(this.bgIframe){
				this.bgIframe.destroy(preserveDom);
				delete this.bgIframe;
			}

			if(this.domNode){
				if(preserveDom){
					domAttr.remove(this.domNode, "widgetId");
				}else{
					domConstruct.destroy(this.domNode);
				}
				delete this.domNode;
			}

			if(this.srcNodeRef){
				if(!preserveDom){
					domConstruct.destroy(this.srcNodeRef);
				}
				delete this.srcNodeRef;
			}
		},

		destroyDescendants: function(/*Boolean?*/ preserveDom){
			// summary:
			//		Recursively destroy the children of this widget and their
			//		descendants.
			// preserveDom:
			//		If true, the preserveDom attribute is passed to all descendant
			//		widget's .destroy() method. Not for use with _Templated
			//		widgets.

			// get all direct descendants and destroy them recursively
			array.forEach(this.getChildren(), function(widget){
				if(widget.destroyRecursive){
					widget.destroyRecursive(preserveDom);
				}
			});
		},

		uninitialize: function(){
			// summary:
			//		Deprecated. Override destroy() instead to implement custom widget tear-down
			//		behavior.
			// tags:
			//		protected
			return false;
		},

		////////////////// GET/SET, CUSTOM SETTERS, ETC. ///////////////////

		_setStyleAttr: function(/*String||Object*/ value){
			// summary:
			//		Sets the style attribute of the widget according to value,
			//		which is either a hash like {height: "5px", width: "3px"}
			//		or a plain string
			// description:
			//		Determines which node to set the style on based on style setting
			//		in attributeMap.
			// tags:
			//		protected

			var mapNode = this.domNode;

			// Note: technically we should revert any style setting made in a previous call
			// to his method, but that's difficult to keep track of.

			if(lang.isObject(value)){
				domStyle.set(mapNode, value);
			}else{
				if(mapNode.style.cssText){
					mapNode.style.cssText += "; " + value;
				}else{
					mapNode.style.cssText = value;
				}
			}

			this._set("style", value);
		},

		_attrToDom: function(/*String*/ attr, /*String*/ value, /*Object?*/ commands){
			// summary:
			//		Reflect a widget attribute (title, tabIndex, duration etc.) to
			//		the widget DOM, as specified by commands parameter.
			//		If commands isn't specified then it's looked up from attributeMap.
			//		Note some attributes like "type"
			//		cannot be processed this way as they are not mutable.
			// attr:
			//		Name of member variable (ex: "focusNode" maps to this.focusNode) pointing
			//		to DOMNode inside the widget, or alternately pointing to a subwidget
			// tags:
			//		private

			commands = arguments.length >= 3 ? commands : this.attributeMap[attr];

			array.forEach(lang.isArray(commands) ? commands : [commands], function(command){

				// Get target node and what we are doing to that node
				var mapNode = this[command.node || command || "domNode"];	// DOM node
				var type = command.type || "attribute";	// class, innerHTML, innerText, or attribute

				switch(type){
					case "attribute":
						if(lang.isFunction(value)){ // functions execute in the context of the widget
							value = lang.hitch(this, value);
						}

						// Get the name of the DOM node attribute; usually it's the same
						// as the name of the attribute in the widget (attr), but can be overridden.
						// Also maps handler names to lowercase, like onSubmit --> onsubmit
						var attrName = command.attribute ? command.attribute :
							(/^on[A-Z][a-zA-Z]*$/.test(attr) ? attr.toLowerCase() : attr);

						if(mapNode.tagName){
							// Normal case, mapping to a DOMNode.  Note that modern browsers will have a mapNode.set()
							// method, but for consistency we still call domAttr
							domAttr.set(mapNode, attrName, value);
						}else{
							// mapping to a sub-widget
							mapNode.set(attrName, value);
						}
						break;
					case "innerText":
						mapNode.innerHTML = "";
						mapNode.appendChild(this.ownerDocument.createTextNode(value));
						break;
					case "innerHTML":
						mapNode.innerHTML = value;
						break;
					case "class":
						domClass.replace(mapNode, value, this[attr]);
						break;
				}
			}, this);
		},

		get: function(name){
			// summary:
			//		Get a property from a widget.
			// name:
			//		The property to get.
			// description:
			//		Get a named property from a widget. The property may
			//		potentially be retrieved via a getter method. If no getter is defined, this
			//		just retrieves the object's property.
			//
			//		For example, if the widget has properties `foo` and `bar`
			//		and a method named `_getFooAttr()`, calling:
			//		`myWidget.get("foo")` would be equivalent to calling
			//		`widget._getFooAttr()` and `myWidget.get("bar")`
			//		would be equivalent to the expression
			//		`widget.bar2`
			var names = this._getAttrNames(name);
			return this[names.g] ? this[names.g]() : this._get(name);
		},

		set: function(name, value){
			// summary:
			//		Set a property on a widget
			// name:
			//		The property to set.
			// value:
			//		The value to set in the property.
			// description:
			//		Sets named properties on a widget which may potentially be handled by a
			//		setter in the widget.
			//
			//		For example, if the widget has properties `foo` and `bar`
			//		and a method named `_setFooAttr()`, calling
			//		`myWidget.set("foo", "Howdy!")` would be equivalent to calling
			//		`widget._setFooAttr("Howdy!")` and `myWidget.set("bar", 3)`
			//		would be equivalent to the statement `widget.bar = 3;`
			//
			//		set() may also be called with a hash of name/value pairs, ex:
			//
			//	|	myWidget.set({
			//	|		foo: "Howdy",
			//	|		bar: 3
			//	|	});
			//
			//	This is equivalent to calling `set(foo, "Howdy")` and `set(bar, 3)`

			if(typeof name === "object"){
				for(var x in name){
					this.set(x, name[x]);
				}
				return this;
			}
			var names = this._getAttrNames(name),
				setter = this[names.s];
			if(lang.isFunction(setter)){
				// use the explicit setter
				var result = setter.apply(this, Array.prototype.slice.call(arguments, 1));
			}else{
				// Mapping from widget attribute to DOMNode/subwidget attribute/value/etc.
				// Map according to:
				//		1. attributeMap setting, if one exists (TODO: attributeMap deprecated, remove in 2.0)
				//		2. _setFooAttr: {...} type attribute in the widget (if one exists)
				//		3. apply to focusNode or domNode if standard attribute name, excluding funcs like onClick.
				// Checks if an attribute is a "standard attribute" by whether the DOMNode JS object has a similar
				// attribute name (ex: accept-charset attribute matches jsObject.acceptCharset).
				// Note also that Tree.focusNode() is a function not a DOMNode, so test for that.
				var defaultNode = this.focusNode && !lang.isFunction(this.focusNode) ? "focusNode" : "domNode",
					tag = this[defaultNode] && this[defaultNode].tagName,
					attrsForTag = tag && (tagAttrs[tag] || (tagAttrs[tag] = getAttrs(this[defaultNode]))),
					map = name in this.attributeMap ? this.attributeMap[name] :
						names.s in this ? this[names.s] :
							((attrsForTag && names.l in attrsForTag && typeof value != "function") ||
								/^aria-|^data-|^role$/.test(name)) ? defaultNode : null;
				if(map != null){
					this._attrToDom(name, value, map);
				}
				this._set(name, value);
			}
			return result || this;
		},

		_attrPairNames: {}, // shared between all widgets
		_getAttrNames: function(name){
			// summary:
			//		Helper function for get() and set().
			//		Caches attribute name values so we don't do the string ops every time.
			// tags:
			//		private

			var apn = this._attrPairNames;
			if(apn[name]){
				return apn[name];
			}
			var uc = name.replace(/^[a-z]|-[a-zA-Z]/g, function(c){
				return c.charAt(c.length - 1).toUpperCase();
			});
			return (apn[name] = {
				n: name + "Node",
				s: "_set" + uc + "Attr", // converts dashes to camel case, ex: accept-charset --> _setAcceptCharsetAttr
				g: "_get" + uc + "Attr",
				l: uc.toLowerCase()        // lowercase name w/out dashes, ex: acceptcharset
			});
		},

		_set: function(/*String*/ name, /*anything*/ value){
			// summary:
			//		Helper function to set new value for specified property, and call handlers
			//		registered with watch() if the value has changed.
			var oldValue = this[name];
			this[name] = value;
			if(this._created && value !== oldValue){
				if(this._watchCallbacks){
					this._watchCallbacks(name, oldValue, value);
				}
				this.emit("attrmodified-" + name, {
					detail: {
						prevValue: oldValue,
						newValue: value
					}
				});
			}
		},

		_get: function(/*String*/ name){
			// summary:
			//		Helper function to get value for specified property stored by this._set(),
			//		i.e. for properties with custom setters.  Used mainly by custom getters.
			//
			//		For example, CheckBox._getValueAttr() calls this._get("value").

			// future: return name in this.props ? this.props[name] : this[name];
			return this[name];
		},

		emit: function(/*String*/ type, /*Object?*/ eventObj, /*Array?*/ callbackArgs){
			// summary:
			//		Used by widgets to signal that a synthetic event occurred, ex:
			//	|	myWidget.emit("attrmodified-selectedChildWidget", {}).
			//
			//		Emits an event on this.domNode named type.toLowerCase(), based on eventObj.
			//		Also calls onType() method, if present, and returns value from that method.
			//		By default passes eventObj to callback, but will pass callbackArgs instead, if specified.
			//		Modifies eventObj by adding missing parameters (bubbles, cancelable, widget).
			// tags:
			//		protected

			// Specify fallback values for bubbles, cancelable in case they are not set in eventObj.
			// Also set pointer to widget, although since we can't add a pointer to the widget for native events
			// (see #14729), maybe we shouldn't do it here?
			eventObj = eventObj || {};
			if(eventObj.bubbles === undefined){
				eventObj.bubbles = true;
			}
			if(eventObj.cancelable === undefined){
				eventObj.cancelable = true;
			}
			if(!eventObj.detail){
				eventObj.detail = {};
			}
			eventObj.detail.widget = this;

			var ret, callback = this["on" + type];
			if(callback){
				ret = callback.apply(this, callbackArgs ? callbackArgs : [eventObj]);
			}

			// Emit event, but avoid spurious emit()'s as parent sets properties on child during startup/destroy
			if(this._started && !this._beingDestroyed){
				on.emit(this.domNode, type.toLowerCase(), eventObj);
			}

			return ret;
		},

		on: function(/*String|Function*/ type, /*Function*/ func){
			// summary:
			//		Call specified function when event occurs, ex: myWidget.on("click", function(){ ... }).
			// type:
			//		Name of event (ex: "click") or extension event like touch.press.
			// description:
			//		Call specified function when event `type` occurs, ex: `myWidget.on("click", function(){ ... })`.
			//		Note that the function is not run in any particular scope, so if (for example) you want it to run in the
			//		widget's scope you must do `myWidget.on("click", lang.hitch(myWidget, func))`.

			// For backwards compatibility, if there's an onType() method in the widget then connect to that.
			// Remove in 2.0.
			var widgetMethod = this._onMap(type);
			if(widgetMethod){
				return aspect.after(this, widgetMethod, func, true);
			}

			// Otherwise, just listen for the event on this.domNode.
			return this.own(on(this.domNode, type, func))[0];
		},

		_onMap: function(/*String|Function*/ type){
			// summary:
			//		Maps on() type parameter (ex: "mousemove") to method name (ex: "onMouseMove").
			//		If type is a synthetic event like touch.press then returns undefined.
			var ctor = this.constructor, map = ctor._onMap;
			if(!map){
				map = (ctor._onMap = {});
				for(var attr in ctor.prototype){
					if(/^on/.test(attr)){
						map[attr.replace(/^on/, "").toLowerCase()] = attr;
					}
				}
			}
			return map[typeof type == "string" && type.toLowerCase()];	// String
		},

		toString: function(){
			// summary:
			//		Returns a string that represents the widget.
			// description:
			//		When a widget is cast to a string, this method will be used to generate the
			//		output. Currently, it does not implement any sort of reversible
			//		serialization.
			return '[Widget ' + this.declaredClass + ', ' + (this.id || 'NO ID') + ']'; // String
		},

		getChildren: function(){
			// summary:
			//		Returns all direct children of this widget, i.e. all widgets underneath this.containerNode whose parent
			//		is this widget.   Note that it does not return all descendants, but rather just direct children.
			//		Analogous to [Node.childNodes](https://developer.mozilla.org/en-US/docs/DOM/Node.childNodes),
			//		except containing widgets rather than DOMNodes.
			//
			//		The result intentionally excludes internally created widgets (a.k.a. supporting widgets)
			//		outside of this.containerNode.
			//
			//		Note that the array returned is a simple array.  Application code should not assume
			//		existence of methods like forEach().

			return this.containerNode ? registry.findWidgets(this.containerNode) : []; // dijit/_WidgetBase[]
		},

		getParent: function(){
			// summary:
			//		Returns the parent widget of this widget.

			return registry.getEnclosingWidget(this.domNode.parentNode);
		},

		connect: function(/*Object|null*/ obj, /*String|Function*/ event, /*String|Function*/ method){
			// summary:
			//		Deprecated, will be removed in 2.0, use this.own(on(...)) or this.own(aspect.after(...)) instead.
			//
			//		Connects specified obj/event to specified method of this object
			//		and registers for disconnect() on widget destroy.
			//
			//		Provide widget-specific analog to dojo.connect, except with the
			//		implicit use of this widget as the target object.
			//		Events connected with `this.connect` are disconnected upon
			//		destruction.
			// returns:
			//		A handle that can be passed to `disconnect` in order to disconnect before
			//		the widget is destroyed.
			// example:
			//	|	var btn = new Button();
			//	|	// when foo.bar() is called, call the listener we're going to
			//	|	// provide in the scope of btn
			//	|	btn.connect(foo, "bar", function(){
			//	|		console.debug(this.toString());
			//	|	});
			// tags:
			//		protected

			return this.own(connect.connect(obj, event, this, method))[0];	// handle
		},

		disconnect: function(handle){
			// summary:
			//		Deprecated, will be removed in 2.0, use handle.remove() instead.
			//
			//		Disconnects handle created by `connect`.
			// tags:
			//		protected

			handle.remove();
		},

		subscribe: function(t, method){
			// summary:
			//		Deprecated, will be removed in 2.0, use this.own(topic.subscribe()) instead.
			//
			//		Subscribes to the specified topic and calls the specified method
			//		of this object and registers for unsubscribe() on widget destroy.
			//
			//		Provide widget-specific analog to dojo.subscribe, except with the
			//		implicit use of this widget as the target object.
			// t: String
			//		The topic
			// method: Function
			//		The callback
			// example:
			//	|	var btn = new Button();
			//	|	// when /my/topic is published, this button changes its label to
			//	|	// be the parameter of the topic.
			//	|	btn.subscribe("/my/topic", function(v){
			//	|		this.set("label", v);
			//	|	});
			// tags:
			//		protected
			return this.own(topic.subscribe(t, lang.hitch(this, method)))[0];	// handle
		},

		unsubscribe: function(/*Object*/ handle){
			// summary:
			//		Deprecated, will be removed in 2.0, use handle.remove() instead.
			//
			//		Unsubscribes handle created by this.subscribe.
			//		Also removes handle from this widget's list of subscriptions
			// tags:
			//		protected

			handle.remove();
		},

		isLeftToRight: function(){
			// summary:
			//		Return this widget's explicit or implicit orientation (true for LTR, false for RTL)
			// tags:
			//		protected
			return this.dir ? (this.dir == "ltr") : domGeometry.isBodyLtr(this.ownerDocument); //Boolean
		},

		isFocusable: function(){
			// summary:
			//		Return true if this widget can currently be focused
			//		and false if not
			return this.focus && (domStyle.get(this.domNode, "display") != "none");
		},

		placeAt: function(/* String|DomNode|_Widget */ reference, /* String|Int? */ position){
			// summary:
			//		Place this widget somewhere in the DOM based
			//		on standard domConstruct.place() conventions.
			// description:
			//		A convenience function provided in all _Widgets, providing a simple
			//		shorthand mechanism to put an existing (or newly created) Widget
			//		somewhere in the dom, and allow chaining.
			// reference:
			//		Widget, DOMNode, or id of widget or DOMNode
			// position:
			//		If reference is a widget (or id of widget), and that widget has an ".addChild" method,
			//		it will be called passing this widget instance into that method, supplying the optional
			//		position index passed.  In this case position (if specified) should be an integer.
			//
			//		If reference is a DOMNode (or id matching a DOMNode but not a widget),
			//		the position argument can be a numeric index or a string
			//		"first", "last", "before", or "after", same as dojo/dom-construct::place().
			// returns: dijit/_WidgetBase
			//		Provides a useful return of the newly created dijit._Widget instance so you
			//		can "chain" this function by instantiating, placing, then saving the return value
			//		to a variable.
			// example:
			//	|	// create a Button with no srcNodeRef, and place it in the body:
			//	|	var button = new Button({ label:"click" }).placeAt(win.body());
			//	|	// now, 'button' is still the widget reference to the newly created button
			//	|	button.on("click", function(e){ console.log('click'); }));
			// example:
			//	|	// create a button out of a node with id="src" and append it to id="wrapper":
			//	|	var button = new Button({},"src").placeAt("wrapper");
			// example:
			//	|	// place a new button as the first element of some div
			//	|	var button = new Button({ label:"click" }).placeAt("wrapper","first");
			// example:
			//	|	// create a contentpane and add it to a TabContainer
			//	|	var tc = dijit.byId("myTabs");
			//	|	new ContentPane({ href:"foo.html", title:"Wow!" }).placeAt(tc)

			var refWidget = !reference.tagName && registry.byId(reference);
			if(refWidget && refWidget.addChild && (!position || typeof position === "number")){
				// Adding this to refWidget and can use refWidget.addChild() to handle everything.
				refWidget.addChild(this, position);
			}else{
				// "reference" is a plain DOMNode, or we can't use refWidget.addChild().   Use domConstruct.place() and
				// target refWidget.containerNode for nested placement (position==number, "first", "last", "only"), and
				// refWidget.domNode otherwise ("after"/"before"/"replace").  (But not supported officially, see #14946.)
				var ref = refWidget ?
					(refWidget.containerNode && !/after|before|replace/.test(position || "") ?
						refWidget.containerNode : refWidget.domNode) : dom.byId(reference, this.ownerDocument);
				domConstruct.place(this.domNode, ref, position);

				// Start this iff it has a parent widget that's already started.
				// TODO: for 2.0 maybe it should also start the widget when this.getParent() returns null??
				if(!this._started && (this.getParent() || {})._started){
					this.startup();
				}
			}
			return this;
		},

		defer: function(fcn, delay){
			// summary:
			//		Wrapper to setTimeout to avoid deferred functions executing
			//		after the originating widget has been destroyed.
			//		Returns an object handle with a remove method (that returns null) (replaces clearTimeout).
			// fcn: function reference
			// delay: Optional number (defaults to 0)
			// tags:
			//		protected.
			var timer = setTimeout(lang.hitch(this,
				function(){
					if(!timer){
						return;
					}
					timer = null;
					if(!this._destroyed){
						lang.hitch(this, fcn)();
					}
				}),
				delay || 0
			);
			return {
				remove: function(){
					if(timer){
						clearTimeout(timer);
						timer = null;
					}
					return null; // so this works well: handle = handle.remove();
				}
			};
		}
	});

	if(has("dojo-bidi")){
		_WidgetBase.extend(_BidiMixin);
	}

	return _WidgetBase;
});

},
'dojo/Stateful':function(){
define(["./_base/declare", "./_base/lang", "./_base/array", "./when"], function(declare, lang, array, when){
	// module:
	//		dojo/Stateful

return declare("dojo.Stateful", null, {
	// summary:
	//		Base class for objects that provide named properties with optional getter/setter
	//		control and the ability to watch for property changes
	//
	//		The class also provides the functionality to auto-magically manage getters
	//		and setters for object attributes/properties.
	//		
	//		Getters and Setters should follow the format of _xxxGetter or _xxxSetter where 
	//		the xxx is a name of the attribute to handle.  So an attribute of "foo" 
	//		would have a custom getter of _fooGetter and a custom setter of _fooSetter.
	//
	// example:
	//	|	var obj = new dojo.Stateful();
	//	|	obj.watch("foo", function(){
	//	|		console.log("foo changed to " + this.get("foo"));
	//	|	});
	//	|	obj.set("foo","bar");

	// _attrPairNames: Hash
	//		Used across all instances a hash to cache attribute names and their getter 
	//		and setter names.
	_attrPairNames: {},

	_getAttrNames: function(name){
		// summary:
		//		Helper function for get() and set().
		//		Caches attribute name values so we don't do the string ops every time.
		// tags:
		//		private

		var apn = this._attrPairNames;
		if(apn[name]){ return apn[name]; }
		return (apn[name] = {
			s: "_" + name + "Setter",
			g: "_" + name + "Getter"
		});
	},

	postscript: function(/*Object?*/ params){
		// Automatic setting of params during construction
		if (params){ this.set(params); }
	},

	_get: function(name, names){
		// summary:
		//		Private function that does a get based off a hash of names
		// names:
		//		Hash of names of custom attributes
		return typeof this[names.g] === "function" ? this[names.g]() : this[name];
	},
	get: function(/*String*/name){
		// summary:
		//		Get a property on a Stateful instance.
		// name:
		//		The property to get.
		// returns:
		//		The property value on this Stateful instance.
		// description:
		//		Get a named property on a Stateful object. The property may
		//		potentially be retrieved via a getter method in subclasses. In the base class
		//		this just retrieves the object's property.
		//		For example:
		//	|	stateful = new dojo.Stateful({foo: 3});
		//	|	stateful.get("foo") // returns 3
		//	|	stateful.foo // returns 3

		return this._get(name, this._getAttrNames(name)); //Any
	},
	set: function(/*String*/name, /*Object*/value){
		// summary:
		//		Set a property on a Stateful instance
		// name:
		//		The property to set.
		// value:
		//		The value to set in the property.
		// returns:
		//		The function returns this dojo.Stateful instance.
		// description:
		//		Sets named properties on a stateful object and notifies any watchers of
		//		the property. A programmatic setter may be defined in subclasses.
		//		For example:
		//	|	stateful = new dojo.Stateful();
		//	|	stateful.watch(function(name, oldValue, value){
		//	|		// this will be called on the set below
		//	|	}
		//	|	stateful.set(foo, 5);
		//
		//	set() may also be called with a hash of name/value pairs, ex:
		//	|	myObj.set({
		//	|		foo: "Howdy",
		//	|		bar: 3
		//	|	})
		//	This is equivalent to calling set(foo, "Howdy") and set(bar, 3)

		// If an object is used, iterate through object
		if(typeof name === "object"){
			for(var x in name){
				if(name.hasOwnProperty(x) && x !="_watchCallbacks"){
					this.set(x, name[x]);
				}
			}
			return this;
		}

		var names = this._getAttrNames(name),
			oldValue = this._get(name, names),
			setter = this[names.s],
			result;
		if(typeof setter === "function"){
			// use the explicit setter
			result = setter.apply(this, Array.prototype.slice.call(arguments, 1));
		}else{
			// no setter so set attribute directly
			this[name] = value;
		}
		if(this._watchCallbacks){
			var self = this;
			// If setter returned a promise, wait for it to complete, otherwise call watches immediatly
			when(result, function(){
				self._watchCallbacks(name, oldValue, value);
			});
		}
		return this; // dojo/Stateful
	},
	_changeAttrValue: function(name, value){
		// summary:
		//		Internal helper for directly changing an attribute value.
		//
		// name: String
		//		The property to set.
		// value: Mixed
		//		The value to set in the property.
		//
		// description:
		//		Directly change the value of an attribute on an object, bypassing any 
		//		accessor setter.  Also handles the calling of watch and emitting events. 
		//		It is designed to be used by descendent class when there are two values 
		//		of attributes that are linked, but calling .set() is not appropriate.

		var oldValue = this.get(name);
		this[name] = value;
		if(this._watchCallbacks){
			this._watchCallbacks(name, oldValue, value);
		}
		return this; // dojo/Stateful
	},
	watch: function(/*String?*/name, /*Function*/callback){
		// summary:
		//		Watches a property for changes
		// name:
		//		Indicates the property to watch. This is optional (the callback may be the
		//		only parameter), and if omitted, all the properties will be watched
		// returns:
		//		An object handle for the watch. The unwatch method of this object
		//		can be used to discontinue watching this property:
		//		|	var watchHandle = obj.watch("foo", callback);
		//		|	watchHandle.unwatch(); // callback won't be called now
		// callback:
		//		The function to execute when the property changes. This will be called after
		//		the property has been changed. The callback will be called with the |this|
		//		set to the instance, the first argument as the name of the property, the
		//		second argument as the old value and the third argument as the new value.

		var callbacks = this._watchCallbacks;
		if(!callbacks){
			var self = this;
			callbacks = this._watchCallbacks = function(name, oldValue, value, ignoreCatchall){
				var notify = function(propertyCallbacks){
					if(propertyCallbacks){
						propertyCallbacks = propertyCallbacks.slice();
						for(var i = 0, l = propertyCallbacks.length; i < l; i++){
							propertyCallbacks[i].call(self, name, oldValue, value);
						}
					}
				};
				notify(callbacks['_' + name]);
				if(!ignoreCatchall){
					notify(callbacks["*"]); // the catch-all
				}
			}; // we use a function instead of an object so it will be ignored by JSON conversion
		}
		if(!callback && typeof name === "function"){
			callback = name;
			name = "*";
		}else{
			// prepend with dash to prevent name conflicts with function (like "name" property)
			name = '_' + name;
		}
		var propertyCallbacks = callbacks[name];
		if(typeof propertyCallbacks !== "object"){
			propertyCallbacks = callbacks[name] = [];
		}
		propertyCallbacks.push(callback);

		// TODO: Remove unwatch in 2.0
		var handle = {};
		handle.unwatch = handle.remove = function(){
			var index = array.indexOf(propertyCallbacks, callback);
			if(index > -1){
				propertyCallbacks.splice(index, 1);
			}
		};
		return handle; //Object
	}

});

});

},
'dijit/_WidgetsInTemplateMixin':function(){
define([
	"dojo/_base/array", // forEach()
	"dojo/aspect", // after()
	"dojo/_base/declare", // declare()
	"dojo/_base/lang",	// hitch()
	"dojo/parser" // parse()
], function(array, aspect, declare, lang, parser){

	// module:
	//		dijit/_WidgetsInTemplateMixin

	return declare("dijit._WidgetsInTemplateMixin", null, {
		// summary:
		//		Mixin to supplement _TemplatedMixin when template contains widgets

		// _earlyTemplatedStartup: Boolean
		//		A fallback to preserve the 1.0 - 1.3 behavior of children in
		//		templates having their startup called before the parent widget
		//		fires postCreate. Defaults to 'false', causing child widgets to
		//		have their .startup() called immediately before a parent widget
		//		.startup(), but always after the parent .postCreate(). Set to
		//		'true' to re-enable to previous, arguably broken, behavior.
		_earlyTemplatedStartup: false,

		// widgetsInTemplate: [protected] Boolean
		//		Should we parse the template to find widgets that might be
		//		declared in markup inside it?  (Remove for 2.0 and assume true)
		widgetsInTemplate: true,

		// contextRequire: Function
		//		Used to provide a context require to the dojo/parser in order to be
		//		able to use relative MIDs (e.g. `./Widget`) in the widget's template.
		contextRequire: null,

		_beforeFillContent: function(){
			if(this.widgetsInTemplate){
				// Before copying over content, instantiate widgets in template
				var node = this.domNode;

				if(this.containerNode && !this.searchContainerNode){
					// Tell parse call below not to look for widgets inside of this.containerNode
					this.containerNode.stopParser = true;
				}

				parser.parse(node, {
					noStart: !this._earlyTemplatedStartup,
					template: true,
					inherited: {dir: this.dir, lang: this.lang, textDir: this.textDir},
					propsThis: this,	// so data-dojo-props of widgets in the template can reference "this" to refer to me
					contextRequire: this.contextRequire,
					scope: "dojo"	// even in multi-version mode templates use dojoType/data-dojo-type
				}).then(lang.hitch(this, function(widgets){
					this._startupWidgets = widgets;

					// _WidgetBase::destroy() will destroy any supporting widgets under this.domNode.
					// If we wanted to, we could call this.own() on anything in this._startupWidgets that was moved outside
					// of this.domNode (like Dialog, which is moved to <body>).

					// Hook up attach points and events for nodes that were converted to widgets
					for(var i = 0; i < widgets.length; i++){
						this._processTemplateNode(widgets[i], function(n,p){
							// callback to get a property of a widget
							return n[p];
						}, function(widget, type, callback){
							// callback to do data-dojo-attach-event to a widget
							if(type in widget){
								// back-compat, remove for 2.0
								return widget.connect(widget, type, callback);
							}else{
								// 1.x may never hit this branch, but it's the default for 2.0
								return widget.on(type, callback, true);
							}
						});
					}

					// Cleanup flag set above, just in case
					if(this.containerNode && this.containerNode.stopParser){
						delete this.containerNode.stopParser;
					}
				}));

				if(!this._startupWidgets){
					throw new Error(this.declaredClass + ": parser returned unfilled promise (probably waiting for module auto-load), " +
						"unsupported by _WidgetsInTemplateMixin.   Must pre-load all supporting widgets before instantiation.");
				}
			}
		},

		_processTemplateNode: function(/*DOMNode|Widget*/ baseNode, getAttrFunc, attachFunc){
			// Override _AttachMixin._processNode to skip DOMNodes with data-dojo-type set.   They are handled separately
			// in the _beforeFillContent() code above.

			if(getAttrFunc(baseNode, "dojoType") || getAttrFunc(baseNode, "data-dojo-type")){
				return true;
			}

			return this.inherited(arguments);
		},

		startup: function(){
			array.forEach(this._startupWidgets, function(w){
				if(w && !w._started && w.startup){
					w.startup();
				}
			});
			this._startupWidgets = null;
			this.inherited(arguments);
		}
	});
});

},
'dojo/parser':function(){
define([
	"require", "./_base/kernel", "./_base/lang", "./_base/array", "./_base/config", "./dom", "./_base/window",
		"./_base/url", "./aspect", "./promise/all", "./date/stamp", "./Deferred", "./has", "./query", "./on", "./ready"
], function(require, dojo, dlang, darray, config, dom, dwindow, _Url, aspect, all, dates, Deferred, has, query, don, ready){

	// module:
	//		dojo/parser

	new Date("X"); // workaround for #11279, new Date("") == NaN

	// data-dojo-props etc. is not restricted to JSON, it can be any javascript
	function myEval(text){
		return eval("(" + text + ")");
	}

	// Widgets like BorderContainer add properties to _Widget via dojo.extend().
	// If BorderContainer is loaded after _Widget's parameter list has been cached,
	// we need to refresh that parameter list (for _Widget and all widgets that extend _Widget).
	var extendCnt = 0;
	aspect.after(dlang, "extend", function(){
		extendCnt++;
	}, true);

	function getNameMap(ctor){
		// summary:
		//		Returns map from lowercase name to attribute name in class, ex: {onclick: "onClick"}
		var map = ctor._nameCaseMap, proto = ctor.prototype;

		// Create the map if it's undefined.
		// Refresh the map if a superclass was possibly extended with new methods since the map was created.
		if(!map || map._extendCnt < extendCnt){
			map = ctor._nameCaseMap = {};
			for(var name in proto){
				if(name.charAt(0) === "_"){
					continue;
				}	// skip internal properties
				map[name.toLowerCase()] = name;
			}
			map._extendCnt = extendCnt;
		}
		return map;
	}

	// Map from widget name or list of widget names(ex: "dijit/form/Button,acme/MyMixin") to a constructor.
	var _ctorMap = {};

	function getCtor(/*String[]*/ types, /*Function?*/ contextRequire){
		// summary:
		//		Retrieves a constructor.  If the types array contains more than one class/MID then the
		//		subsequent classes will be mixed into the first class and a unique constructor will be
		//		returned for that array.

		var ts = types.join();
		if(!_ctorMap[ts]){
			var mixins = [];
			for(var i = 0, l = types.length; i < l; i++){
				var t = types[i];
				// TODO: Consider swapping getObject and require in the future
				mixins[mixins.length] = (_ctorMap[t] = _ctorMap[t] || (dlang.getObject(t) || (~t.indexOf('/') &&
					(contextRequire ? contextRequire(t) : require(t)))));
			}
			var ctor = mixins.shift();
			_ctorMap[ts] = mixins.length ? (ctor.createSubclass ? ctor.createSubclass(mixins) : ctor.extend.apply(ctor, mixins)) : ctor;
		}

		return _ctorMap[ts];
	}

	var parser = {
		// summary:
		//		The Dom/Widget parsing package

		_clearCache: function(){
			// summary:
			//		Clear cached data.   Used mainly for benchmarking.
			extendCnt++;
			_ctorMap = {};
		},

		_functionFromScript: function(script, attrData){
			// summary:
			//		Convert a `<script type="dojo/method" args="a, b, c"> ... </script>`
			//		into a function
			// script: DOMNode
			//		The `<script>` DOMNode
			// attrData: String
			//		For HTML5 compliance, searches for attrData + "args" (typically
			//		"data-dojo-args") instead of "args"
			var preamble = "",
				suffix = "",
				argsStr = (script.getAttribute(attrData + "args") || script.getAttribute("args")),
				withStr = script.getAttribute("with");

			// Convert any arguments supplied in script tag into an array to be passed to the
			var fnArgs = (argsStr || "").split(/\s*,\s*/);

			if(withStr && withStr.length){
				darray.forEach(withStr.split(/\s*,\s*/), function(part){
					preamble += "with(" + part + "){";
					suffix += "}";
				});
			}

			return new Function(fnArgs, preamble + script.innerHTML + suffix);
		},

		instantiate: function(nodes, mixin, options){
			// summary:
			//		Takes array of nodes, and turns them into class instances and
			//		potentially calls a startup method to allow them to connect with
			//		any children.
			// nodes: Array
			//		Array of DOM nodes
			// mixin: Object?
			//		An object that will be mixed in with each node in the array.
			//		Values in the mixin will override values in the node, if they
			//		exist.
			// options: Object?
			//		An object used to hold kwArgs for instantiation.
			//		See parse.options argument for details.
			// returns:
			//		Array of instances.

			mixin = mixin || {};
			options = options || {};

			var dojoType = (options.scope || dojo._scopeName) + "Type", // typically "dojoType"
				attrData = "data-" + (options.scope || dojo._scopeName) + "-", // typically "data-dojo-"
				dataDojoType = attrData + "type", // typically "data-dojo-type"
				dataDojoMixins = attrData + "mixins";					// typically "data-dojo-mixins"

			var list = [];
			darray.forEach(nodes, function(node){
				var type = dojoType in mixin ? mixin[dojoType] : node.getAttribute(dataDojoType) || node.getAttribute(dojoType);
				if(type){
					var mixinsValue = node.getAttribute(dataDojoMixins),
						types = mixinsValue ? [type].concat(mixinsValue.split(/\s*,\s*/)) : [type];

					list.push({
						node: node,
						types: types
					});
				}
			});

			// Instantiate the nodes and return the list of instances.
			return this._instantiate(list, mixin, options);
		},

		_instantiate: function(nodes, mixin, options, returnPromise){
			// summary:
			//		Takes array of objects representing nodes, and turns them into class instances and
			//		potentially calls a startup method to allow them to connect with
			//		any children.
			// nodes: Array
			//		Array of objects like
			//	|		{
			//	|			ctor: Function (may be null)
			//	|			types: ["dijit/form/Button", "acme/MyMixin"] (used if ctor not specified)
			//	|			node: DOMNode,
			//	|			scripts: [ ... ],	// array of <script type="dojo/..."> children of node
			//	|			inherited: { ... }	// settings inherited from ancestors like dir, theme, etc.
			//	|		}
			// mixin: Object
			//		An object that will be mixed in with each node in the array.
			//		Values in the mixin will override values in the node, if they
			//		exist.
			// options: Object
			//		An options object used to hold kwArgs for instantiation.
			//		See parse.options argument for details.
			// returnPromise: Boolean
			//		Return a Promise rather than the instance; supports asynchronous widget creation.
			// returns:
			//		Array of instances, or if returnPromise is true, a promise for array of instances
			//		that resolves when instances have finished initializing.

			// Call widget constructors.   Some may be asynchronous and return promises.
			var thelist = darray.map(nodes, function(obj){
				var ctor = obj.ctor || getCtor(obj.types, options.contextRequire);
				// If we still haven't resolved a ctor, it is fatal now
				if(!ctor){
					throw new Error("Unable to resolve constructor for: '" + obj.types.join() + "'");
				}
				return this.construct(ctor, obj.node, mixin, options, obj.scripts, obj.inherited);
			}, this);

			// After all widget construction finishes, call startup on each top level instance if it makes sense (as for
			// widgets).  Parent widgets will recursively call startup on their (non-top level) children
			function onConstruct(thelist){
				if(!mixin._started && !options.noStart){
					darray.forEach(thelist, function(instance){
						if(typeof instance.startup === "function" && !instance._started){
							instance.startup();
						}
					});
				}

				return thelist;
			}

			if(returnPromise){
				return all(thelist).then(onConstruct);
			}else{
				// Back-compat path, remove for 2.0
				return onConstruct(thelist);
			}
		},

		construct: function(ctor, node, mixin, options, scripts, inherited){
			// summary:
			//		Calls new ctor(params, node), where params is the hash of parameters specified on the node,
			//		excluding data-dojo-type and data-dojo-mixins.   Does not call startup().
			// ctor: Function
			//		Widget constructor.
			// node: DOMNode
			//		This node will be replaced/attached to by the widget.  It also specifies the arguments to pass to ctor.
			// mixin: Object?
			//		Attributes in this object will be passed as parameters to ctor,
			//		overriding attributes specified on the node.
			// options: Object?
			//		An options object used to hold kwArgs for instantiation.   See parse.options argument for details.
			// scripts: DomNode[]?
			//		Array of `<script type="dojo/*">` DOMNodes.  If not specified, will search for `<script>` tags inside node.
			// inherited: Object?
			//		Settings from dir=rtl or lang=... on a node above this node.   Overrides options.inherited.
			// returns:
			//		Instance or Promise for the instance, if markupFactory() itself returned a promise

			var proto = ctor && ctor.prototype;
			options = options || {};

			// Setup hash to hold parameter settings for this widget.	Start with the parameter
			// settings inherited from ancestors ("dir" and "lang").
			// Inherited setting may later be overridden by explicit settings on node itself.
			var params = {};

			if(options.defaults){
				// settings for the document itself (or whatever subtree is being parsed)
				dlang.mixin(params, options.defaults);
			}
			if(inherited){
				// settings from dir=rtl or lang=... on a node above this node
				dlang.mixin(params, inherited);
			}

			// Get list of attributes explicitly listed in the markup
			var attributes;
			if(has("dom-attributes-explicit")){
				// Standard path to get list of user specified attributes
				attributes = node.attributes;
			}else if(has("dom-attributes-specified-flag")){
				// Special processing needed for IE8, to skip a few faux values in attributes[]
				attributes = darray.filter(node.attributes, function(a){
					return a.specified;
				});
			}else{
				// Special path for IE6-7, avoid (sometimes >100) bogus entries in node.attributes
				var clone = /^input$|^img$/i.test(node.nodeName) ? node : node.cloneNode(false),
					attrs = clone.outerHTML.replace(/=[^\s"']+|="[^"]*"|='[^']*'/g, "").replace(/^\s*<[a-zA-Z0-9]*\s*/, "").replace(/\s*>.*$/, "");

				attributes = darray.map(attrs.split(/\s+/), function(name){
					var lcName = name.toLowerCase();
					return {
						name: name,
						// getAttribute() doesn't work for button.value, returns innerHTML of button.
						// but getAttributeNode().value doesn't work for the form.encType or li.value
						value: (node.nodeName == "LI" && name == "value") || lcName == "enctype" ?
							node.getAttribute(lcName) : node.getAttributeNode(lcName).value
					};
				});
			}

			// Hash to convert scoped attribute name (ex: data-dojo17-params) to something friendly (ex: data-dojo-params)
			// TODO: remove scope for 2.0
			var scope = options.scope || dojo._scopeName,
				attrData = "data-" + scope + "-", // typically "data-dojo-"
				hash = {};
			if(scope !== "dojo"){
				hash[attrData + "props"] = "data-dojo-props";
				hash[attrData + "type"] = "data-dojo-type";
				hash[attrData + "mixins"] = "data-dojo-mixins";
				hash[scope + "type"] = "dojoType";
				hash[attrData + "id"] = "data-dojo-id";
			}

			// Read in attributes and process them, including data-dojo-props, data-dojo-type,
			// dojoAttachPoint, etc., as well as normal foo=bar attributes.
			var i = 0, item, funcAttrs = [], jsname, extra;
			while(item = attributes[i++]){
				var name = item.name,
					lcName = name.toLowerCase(),
					value = item.value;

				switch(hash[lcName] || lcName){
				// Already processed, just ignore
				case "data-dojo-type":
				case "dojotype":
				case "data-dojo-mixins":
					break;

				// Data-dojo-props.   Save for later to make sure it overrides direct foo=bar settings
				case "data-dojo-props":
					extra = value;
					break;

				// data-dojo-id or jsId. TODO: drop jsId in 2.0
				case "data-dojo-id":
				case "jsid":
					jsname = value;
					break;

				// For the benefit of _Templated
				case "data-dojo-attach-point":
				case "dojoattachpoint":
					params.dojoAttachPoint = value;
					break;
				case "data-dojo-attach-event":
				case "dojoattachevent":
					params.dojoAttachEvent = value;
					break;

				// Special parameter handling needed for IE
				case "class":
					params["class"] = node.className;
					break;
				case "style":
					params["style"] = node.style && node.style.cssText;
					break;
				default:
					// Normal attribute, ex: value="123"

					// Find attribute in widget corresponding to specified name.
					// May involve case conversion, ex: onclick --> onClick
					if(!(name in proto)){
						var map = getNameMap(ctor);
						name = map[lcName] || name;
					}

					// Set params[name] to value, doing type conversion
					if(name in proto){
						switch(typeof proto[name]){
						case "string":
							params[name] = value;
							break;
						case "number":
							params[name] = value.length ? Number(value) : NaN;
							break;
						case "boolean":
							// for checked/disabled value might be "" or "checked".	 interpret as true.
							params[name] = value.toLowerCase() != "false";
							break;
						case "function":
							if(value === "" || value.search(/[^\w\.]+/i) != -1){
								// The user has specified some text for a function like "return x+5"
								params[name] = new Function(value);
							}else{
								// The user has specified the name of a global function like "myOnClick"
								// or a single word function "return"
								params[name] = dlang.getObject(value, false) || new Function(value);
							}
							funcAttrs.push(name);	// prevent "double connect", see #15026
							break;
						default:
							var pVal = proto[name];
							params[name] =
								(pVal && "length" in pVal) ? (value ? value.split(/\s*,\s*/) : []) :	// array
									(pVal instanceof Date) ?
										(value == "" ? new Date("") :	// the NaN of dates
										value == "now" ? new Date() :	// current date
										dates.fromISOString(value)) :
								(pVal instanceof _Url) ? (dojo.baseUrl + value) :
								myEval(value);
						}
					}else{
						params[name] = value;
					}
				}
			}

			// Remove function attributes from DOMNode to prevent "double connect" problem, see #15026.
			// Do this as a separate loop since attributes[] is often a live collection (depends on the browser though).
			for(var j = 0; j < funcAttrs.length; j++){
				var lcfname = funcAttrs[j].toLowerCase();
				node.removeAttribute(lcfname);
				node[lcfname] = null;
			}

			// Mix things found in data-dojo-props into the params, overriding any direct settings
			if(extra){
				try{
					extra = myEval.call(options.propsThis, "{" + extra + "}");
					dlang.mixin(params, extra);
				}catch(e){
					// give the user a pointer to their invalid parameters. FIXME: can we kill this in production?
					throw new Error(e.toString() + " in data-dojo-props='" + extra + "'");
				}
			}

			// Any parameters specified in "mixin" override everything else.
			dlang.mixin(params, mixin);

			// Get <script> nodes associated with this widget, if they weren't specified explicitly
			if(!scripts){
				scripts = (ctor && (ctor._noScript || proto._noScript) ? [] : query("> script[type^='dojo/']", node));
			}

			// Process <script type="dojo/*"> script tags
			// <script type="dojo/method" data-dojo-event="foo"> tags are added to params, and passed to
			// the widget on instantiation.
			// <script type="dojo/method"> tags (with no event) are executed after instantiation
			// <script type="dojo/connect" data-dojo-event="foo"> tags are dojo.connected after instantiation,
			// and likewise with <script type="dojo/aspect" data-dojo-method="foo">
			// <script type="dojo/watch" data-dojo-prop="foo"> tags are dojo.watch after instantiation
			// <script type="dojo/on" data-dojo-event="foo"> tags are dojo.on after instantiation
			// note: dojo/* script tags cannot exist in self closing widgets, like <input />
			var aspects = [],	// aspects to connect after instantiation
				calls = [],		// functions to call after instantiation
				watches = [],  // functions to watch after instantiation
				ons = []; // functions to on after instantiation

			if(scripts){
				for(i = 0; i < scripts.length; i++){
					var script = scripts[i];
					node.removeChild(script);
					// FIXME: drop event="" support in 2.0. use data-dojo-event="" instead
					var event = (script.getAttribute(attrData + "event") || script.getAttribute("event")),
						prop = script.getAttribute(attrData + "prop"),
						method = script.getAttribute(attrData + "method"),
						advice = script.getAttribute(attrData + "advice"),
						scriptType = script.getAttribute("type"),
						nf = this._functionFromScript(script, attrData);
					if(event){
						if(scriptType == "dojo/connect"){
							aspects.push({ method: event, func: nf });
						}else if(scriptType == "dojo/on"){
							ons.push({ event: event, func: nf });
						}else{
							// <script type="dojo/method" data-dojo-event="foo">
							// TODO for 2.0: use data-dojo-method="foo" instead (also affects dijit/Declaration)
							params[event] = nf;
						}
					}else if(scriptType == "dojo/aspect"){
						aspects.push({ method: method, advice: advice, func: nf });
					}else if(scriptType == "dojo/watch"){
						watches.push({ prop: prop, func: nf });
					}else{
						calls.push(nf);
					}
				}
			}

			// create the instance
			var markupFactory = ctor.markupFactory || proto.markupFactory;
			var instance = markupFactory ? markupFactory(params, node, ctor) : new ctor(params, node);

			function onInstantiate(instance){
				// map it to the JS namespace if that makes sense
				if(jsname){
					dlang.setObject(jsname, instance);
				}

				// process connections and startup functions
				for(i = 0; i < aspects.length; i++){
					aspect[aspects[i].advice || "after"](instance, aspects[i].method, dlang.hitch(instance, aspects[i].func), true);
				}
				for(i = 0; i < calls.length; i++){
					calls[i].call(instance);
				}
				for(i = 0; i < watches.length; i++){
					instance.watch(watches[i].prop, watches[i].func);
				}
				for(i = 0; i < ons.length; i++){
					don(instance, ons[i].event, ons[i].func);
				}

				return instance;
			}

			if(instance.then){
				return instance.then(onInstantiate);
			}else{
				return onInstantiate(instance);
			}
		},

		scan: function(root, options){
			// summary:
			//		Scan a DOM tree and return an array of objects representing the DOMNodes
			//		that need to be turned into widgets.
			// description:
			//		Search specified node (or document root node) recursively for class instances
			//		and return an array of objects that represent potential widgets to be
			//		instantiated. Searches for either data-dojo-type="MID" or dojoType="MID" where
			//		"MID" is a module ID like "dijit/form/Button" or a fully qualified Class name
			//		like "dijit/form/Button".  If the MID is not currently available, scan will
			//		attempt to require() in the module.
			//
			//		See parser.parse() for details of markup.
			// root: DomNode?
			//		A default starting root node from which to start the parsing. Can be
			//		omitted, defaulting to the entire document. If omitted, the `options`
			//		object can be passed in this place. If the `options` object has a
			//		`rootNode` member, that is used.
			// options: Object
			//		a kwArgs options object, see parse() for details
			//
			// returns: Promise
			//		A promise that is resolved with the nodes that have been parsed.

			var list = [], // Output List
				mids = [], // An array of modules that are not yet loaded
				midsHash = {}; // Used to keep the mids array unique

			var dojoType = (options.scope || dojo._scopeName) + "Type", // typically "dojoType"
				attrData = "data-" + (options.scope || dojo._scopeName) + "-", // typically "data-dojo-"
				dataDojoType = attrData + "type", // typically "data-dojo-type"
				dataDojoTextDir = attrData + "textdir", // typically "data-dojo-textdir"
				dataDojoMixins = attrData + "mixins";					// typically "data-dojo-mixins"

			// Info on DOMNode currently being processed
			var node = root.firstChild;

			// Info on parent of DOMNode currently being processed
			//	- inherited: dir, lang, and textDir setting of parent, or inherited by parent
			//	- parent: pointer to identical structure for my parent (or null if no parent)
			//	- scripts: if specified, collects <script type="dojo/..."> type nodes from children
			var inherited = options.inherited;
			if(!inherited){
				function findAncestorAttr(node, attr){
					return (node.getAttribute && node.getAttribute(attr)) ||
						(node.parentNode && findAncestorAttr(node.parentNode, attr));
				}

				inherited = {
					dir: findAncestorAttr(root, "dir"),
					lang: findAncestorAttr(root, "lang"),
					textDir: findAncestorAttr(root, dataDojoTextDir)
				};
				for(var key in inherited){
					if(!inherited[key]){
						delete inherited[key];
					}
				}
			}

			// Metadata about parent node
			var parent = {
				inherited: inherited
			};

			// For collecting <script type="dojo/..."> type nodes (when null, we don't need to collect)
			var scripts;

			// when true, only look for <script type="dojo/..."> tags, and don't recurse to children
			var scriptsOnly;

			function getEffective(parent){
				// summary:
				//		Get effective dir, lang, textDir settings for specified obj
				//		(matching "parent" object structure above), and do caching.
				//		Take care not to return null entries.
				if(!parent.inherited){
					parent.inherited = {};
					var node = parent.node,
						grandparent = getEffective(parent.parent);
					var inherited = {
						dir: node.getAttribute("dir") || grandparent.dir,
						lang: node.getAttribute("lang") || grandparent.lang,
						textDir: node.getAttribute(dataDojoTextDir) || grandparent.textDir
					};
					for(var key in inherited){
						if(inherited[key]){
							parent.inherited[key] = inherited[key];
						}
					}
				}
				return parent.inherited;
			}

			// DFS on DOM tree, collecting nodes with data-dojo-type specified.
			while(true){
				if(!node){
					// Finished this level, continue to parent's next sibling
					if(!parent || !parent.node){
						break;
					}
					node = parent.node.nextSibling;
					scriptsOnly = false;
					parent = parent.parent;
					scripts = parent.scripts;
					continue;
				}

				if(node.nodeType != 1){
					// Text or comment node, skip to next sibling
					node = node.nextSibling;
					continue;
				}

				if(scripts && node.nodeName.toLowerCase() == "script"){
					// Save <script type="dojo/..."> for parent, then continue to next sibling
					type = node.getAttribute("type");
					if(type && /^dojo\/\w/i.test(type)){
						scripts.push(node);
					}
					node = node.nextSibling;
					continue;
				}
				if(scriptsOnly){
					// scriptsOnly flag is set, we have already collected scripts if the parent wants them, so now we shouldn't
					// continue further analysis of the node and will continue to the next sibling
					node = node.nextSibling;
					continue;
				}

				// Check for data-dojo-type attribute, fallback to backward compatible dojoType
				// TODO: Remove dojoType in 2.0
				var type = node.getAttribute(dataDojoType) || node.getAttribute(dojoType);

				// Short circuit for leaf nodes containing nothing [but text]
				var firstChild = node.firstChild;
				if(!type && (!firstChild || (firstChild.nodeType == 3 && !firstChild.nextSibling))){
					node = node.nextSibling;
					continue;
				}

				// Meta data about current node
				var current;

				var ctor = null;
				if(type){
					// If dojoType/data-dojo-type specified, add to output array of nodes to instantiate.
					var mixinsValue = node.getAttribute(dataDojoMixins),
						types = mixinsValue ? [type].concat(mixinsValue.split(/\s*,\s*/)) : [type];

					// Note: won't find classes declared via dojo/Declaration or any modules that haven't been
					// loaded yet so use try/catch to avoid throw from require()
					try{
						ctor = getCtor(types, options.contextRequire);
					}catch(e){}

					// If the constructor was not found, check to see if it has modules that can be loaded
					if(!ctor){
						darray.forEach(types, function(t){
							if(~t.indexOf('/') && !midsHash[t]){
								// If the type looks like a MID and it currently isn't in the array of MIDs to load, add it.
								midsHash[t] = true;
								mids[mids.length] = t;
							}
						});
					}

					var childScripts = ctor && !ctor.prototype._noScript ? [] : null; // <script> nodes that are parent's children

					// Setup meta data about this widget node, and save it to list of nodes to instantiate
					current = {
						types: types,
						ctor: ctor,
						parent: parent,
						node: node,
						scripts: childScripts
					};
					current.inherited = getEffective(current); // dir & lang settings for current node, explicit or inherited
					list.push(current);
				}else{
					// Meta data about this non-widget node
					current = {
						node: node,
						scripts: scripts,
						parent: parent
					};
				}

				// Recurse, collecting <script type="dojo/..."> children, and also looking for
				// descendant nodes with dojoType specified (unless the widget has the stopParser flag).
				// When finished with children, go to my next sibling.
				scripts = childScripts;
				scriptsOnly = node.stopParser || (ctor && ctor.prototype.stopParser && !(options.template));
				parent = current;
				node = firstChild;
			}

			var d = new Deferred();

			// If there are modules to load then require them in
			if(mids.length){
				// Warn that there are modules being auto-required
				if(has("dojo-debug-messages")){
					console.warn("WARNING: Modules being Auto-Required: " + mids.join(", "));
				}
				var r = options.contextRequire || require;
				r(mids, function(){
					// Go through list of widget nodes, filling in missing constructors, and filtering out nodes that shouldn't
					// be instantiated due to a stopParser flag on an ancestor that we belatedly learned about due to
					// auto-require of a module like ContentPane.   Assumes list is in DFS order.
					d.resolve(darray.filter(list, function(widget){
						if(!widget.ctor){
							// Attempt to find the constructor again.   Still won't find classes defined via
							// dijit/Declaration so need to try/catch.
							try{
								widget.ctor = getCtor(widget.types, options.contextRequire);
							}catch(e){}
						}

						// Get the parent widget
						var parent = widget.parent;
						while(parent && !parent.types){
							parent = parent.parent;
						}

						// Return false if this node should be skipped due to stopParser on an ancestor.
						// Since list[] is in DFS order, this loop will always set parent.instantiateChildren before
						// trying to compute widget.instantiate.
						var proto = widget.ctor && widget.ctor.prototype;
						widget.instantiateChildren = !(proto && proto.stopParser && !(options.template));
						widget.instantiate = !parent || (parent.instantiate && parent.instantiateChildren);
						return widget.instantiate;
					}));
				});
			}else{
				// There were no modules to load, so just resolve with the parsed nodes.   This separate code path is for
				// efficiency, to avoid running the require() and the callback code above.
				d.resolve(list);
			}

			// Return the promise
			return d.promise;
		},

		_require: function(/*DOMNode*/ script, /*Object?*/ options){
			// summary:
			//		Helper for _scanAMD().  Takes a `<script type=dojo/require>bar: "acme/bar", ...</script>` node,
			//		calls require() to load the specified modules and (asynchronously) assign them to the specified global
			//		variables, and returns a Promise for when that operation completes.
			//
			//		In the example above, it is effectively doing a require(["acme/bar", ...], function(a){ bar = a; }).

			var hash = myEval("{" + script.innerHTML + "}"), // can't use dojo/json::parse() because maybe no quotes
				vars = [],
				mids = [],
				d = new Deferred();

			var contextRequire = (options && options.contextRequire) || require;

			for(var name in hash){
				vars.push(name);
				mids.push(hash[name]);
			}

			contextRequire(mids, function(){
				for(var i = 0; i < vars.length; i++){
					dlang.setObject(vars[i], arguments[i]);
				}
				d.resolve(arguments);
			});

			return d.promise;
		},

		_scanAmd: function(root, options){
			// summary:
			//		Scans the DOM for any declarative requires and returns their values.
			// description:
			//		Looks for `<script type=dojo/require>bar: "acme/bar", ...</script>` node, calls require() to load the
			//		specified modules and (asynchronously) assign them to the specified global variables,
			//		and returns a Promise for when those operations complete.
			// root: DomNode
			//		The node to base the scan from.
			// options: Object?
			//		a kwArgs options object, see parse() for details

			// Promise that resolves when all the <script type=dojo/require> nodes have finished loading.
			var deferred = new Deferred(),
				promise = deferred.promise;
			deferred.resolve(true);

			var self = this;
			query("script[type='dojo/require']", root).forEach(function(node){
				// Fire off require() call for specified modules.  Chain this require to fire after
				// any previous requires complete, so that layers can be loaded before individual module require()'s fire.
				promise = promise.then(function(){
					return self._require(node, options);
				});

				// Remove from DOM so it isn't seen again
				node.parentNode.removeChild(node);
			});

			return promise;
		},

		parse: function(rootNode, options){
			// summary:
			//		Scan the DOM for class instances, and instantiate them.
			// description:
			//		Search specified node (or root node) recursively for class instances,
			//		and instantiate them. Searches for either data-dojo-type="Class" or
			//		dojoType="Class" where "Class" is a a fully qualified class name,
			//		like `dijit/form/Button`
			//
			//		Using `data-dojo-type`:
			//		Attributes using can be mixed into the parameters used to instantiate the
			//		Class by using a `data-dojo-props` attribute on the node being converted.
			//		`data-dojo-props` should be a string attribute to be converted from JSON.
			//
			//		Using `dojoType`:
			//		Attributes are read from the original domNode and converted to appropriate
			//		types by looking up the Class prototype values. This is the default behavior
			//		from Dojo 1.0 to Dojo 1.5. `dojoType` support is deprecated, and will
			//		go away in Dojo 2.0.
			// rootNode: DomNode?
			//		A default starting root node from which to start the parsing. Can be
			//		omitted, defaulting to the entire document. If omitted, the `options`
			//		object can be passed in this place. If the `options` object has a
			//		`rootNode` member, that is used.
			// options: Object?
			//		A hash of options.
			//
			//		- noStart: Boolean?:
			//			when set will prevent the parser from calling .startup()
			//			when locating the nodes.
			//		- rootNode: DomNode?:
			//			identical to the function's `rootNode` argument, though
			//			allowed to be passed in via this `options object.
			//		- template: Boolean:
			//			If true, ignores ContentPane's stopParser flag and parses contents inside of
			//			a ContentPane inside of a template.   This allows dojoAttachPoint on widgets/nodes
			//			nested inside the ContentPane to work.
			//		- inherited: Object:
			//			Hash possibly containing dir and lang settings to be applied to
			//			parsed widgets, unless there's another setting on a sub-node that overrides
			//		- scope: String:
			//			Root for attribute names to search for.   If scopeName is dojo,
			//			will search for data-dojo-type (or dojoType).   For backwards compatibility
			//			reasons defaults to dojo._scopeName (which is "dojo" except when
			//			multi-version support is used, when it will be something like dojo16, dojo20, etc.)
			//		- propsThis: Object:
			//			If specified, "this" referenced from data-dojo-props will refer to propsThis.
			//			Intended for use from the widgets-in-template feature of `dijit._WidgetsInTemplateMixin`
			//		- contextRequire: Function:
			//			If specified, this require is utilised for looking resolving modules instead of the
			//			`dojo/parser` context `require()`.  Intended for use from the widgets-in-template feature of
			//			`dijit._WidgetsInTemplateMixin`.
			// returns: Mixed
			//		Returns a blended object that is an array of the instantiated objects, but also can include
			//		a promise that is resolved with the instantiated objects.  This is done for backwards
			//		compatibility.  If the parser auto-requires modules, it will always behave in a promise
			//		fashion and `parser.parse().then(function(instances){...})` should be used.
			// example:
			//		Parse all widgets on a page:
			//	|		parser.parse();
			// example:
			//		Parse all classes within the node with id="foo"
			//	|		parser.parse(dojo.byId('foo'));
			// example:
			//		Parse all classes in a page, but do not call .startup() on any
			//		child
			//	|		parser.parse({ noStart: true })
			// example:
			//		Parse all classes in a node, but do not call .startup()
			//	|		parser.parse(someNode, { noStart:true });
			//	|		// or
			//	|		parser.parse({ noStart:true, rootNode: someNode });

			// determine the root node and options based on the passed arguments.
			var root;
			if(!options && rootNode && rootNode.rootNode){
				options = rootNode;
				root = options.rootNode;
			}else if(rootNode && dlang.isObject(rootNode) && !("nodeType" in rootNode)){
				options = rootNode;
			}else{
				root = rootNode;
			}
			root = root ? dom.byId(root) : dwindow.body();

			options = options || {};

			var mixin = options.template ? { template: true } : {},
				instances = [],
				self = this;

			// First scan for any <script type=dojo/require> nodes, and execute.
			// Then scan for all nodes with data-dojo-type, and load any unloaded modules.
			// Then build the object instances.  Add instances to already existing (but empty) instances[] array,
			// which may already have been returned to caller.  Also, use otherwise to collect and throw any errors
			// that occur during the parse().
			var p =
				this._scanAmd(root, options).then(function(){
					return self.scan(root, options);
				}).then(function(parsedNodes){
					return self._instantiate(parsedNodes, mixin, options, true);
				}).then(function(_instances){
					// Copy the instances into the instances[] array we declared above, and are accessing as
					// our return value.
					return instances = instances.concat(_instances);
				}).otherwise(function(e){
					// TODO Modify to follow better pattern for promise error management when available
					console.error("dojo/parser::parse() error", e);
					throw e;
				});

			// Blend the array with the promise
			dlang.mixin(instances, p);
			return instances;
		}
	};

	if( 1 ){
		dojo.parser = parser;
	}

	// Register the parser callback. It should be the first callback
	// after the a11y test.
	if(config.parseOnLoad){
		ready(100, parser, "parse");
	}

	return parser;
});

},
'dojo/_base/url':function(){
define(["./kernel"], function(dojo){
	// module:
	//		dojo/url

	var
		ore = new RegExp("^(([^:/?#]+):)?(//([^/?#]*))?([^?#]*)(\\?([^#]*))?(#(.*))?$"),
		ire = new RegExp("^((([^\\[:]+):)?([^@]+)@)?(\\[([^\\]]+)\\]|([^\\[:]*))(:([0-9]+))?$"),
		_Url = function(){
			var n = null,
				_a = arguments,
				uri = [_a[0]];
			// resolve uri components relative to each other
			for(var i = 1; i<_a.length; i++){
				if(!_a[i]){ continue; }

				// Safari doesn't support this.constructor so we have to be explicit
				// FIXME: Tracked (and fixed) in Webkit bug 3537.
				//		http://bugs.webkit.org/show_bug.cgi?id=3537
				var relobj = new _Url(_a[i]+""),
					uriobj = new _Url(uri[0]+"");

				if(
					relobj.path == "" &&
					!relobj.scheme &&
					!relobj.authority &&
					!relobj.query
				){
					if(relobj.fragment != n){
						uriobj.fragment = relobj.fragment;
					}
					relobj = uriobj;
				}else if(!relobj.scheme){
					relobj.scheme = uriobj.scheme;

					if(!relobj.authority){
						relobj.authority = uriobj.authority;

						if(relobj.path.charAt(0) != "/"){
							var path = uriobj.path.substring(0,
								uriobj.path.lastIndexOf("/") + 1) + relobj.path;

							var segs = path.split("/");
							for(var j = 0; j < segs.length; j++){
								if(segs[j] == "."){
									// flatten "./" references
									if(j == segs.length - 1){
										segs[j] = "";
									}else{
										segs.splice(j, 1);
										j--;
									}
								}else if(j > 0 && !(j == 1 && segs[0] == "") &&
									segs[j] == ".." && segs[j-1] != ".."){
									// flatten "../" references
									if(j == (segs.length - 1)){
										segs.splice(j, 1);
										segs[j - 1] = "";
									}else{
										segs.splice(j - 1, 2);
										j -= 2;
									}
								}
							}
							relobj.path = segs.join("/");
						}
					}
				}

				uri = [];
				if(relobj.scheme){
					uri.push(relobj.scheme, ":");
				}
				if(relobj.authority){
					uri.push("//", relobj.authority);
				}
				uri.push(relobj.path);
				if(relobj.query){
					uri.push("?", relobj.query);
				}
				if(relobj.fragment){
					uri.push("#", relobj.fragment);
				}
			}

			this.uri = uri.join("");

			// break the uri into its main components
			var r = this.uri.match(ore);

			this.scheme = r[2] || (r[1] ? "" : n);
			this.authority = r[4] || (r[3] ? "" : n);
			this.path = r[5]; // can never be undefined
			this.query = r[7] || (r[6] ? "" : n);
			this.fragment	 = r[9] || (r[8] ? "" : n);

			if(this.authority != n){
				// server based naming authority
				r = this.authority.match(ire);

				this.user = r[3] || n;
				this.password = r[4] || n;
				this.host = r[6] || r[7]; // ipv6 || ipv4
				this.port = r[9] || n;
			}
		};
	_Url.prototype.toString = function(){ return this.uri; };

	return dojo._Url = _Url;
});

},
'dojox/app/ViewBase':function(){
define(["require", "dojo/when", "dojo/on", "dojo/dom-attr", "dojo/_base/declare", "dojo/_base/lang",
	"dojo/Deferred", "./utils/model", "./utils/constraints"],
	function(require, when, on, domAttr, declare, lang, Deferred, model, constraints){
	return declare("dojox.app.ViewBase", null, {
		// summary:
		//		View base class with model & controller capabilities. Subclass must implement rendering capabilities.
		constructor: function(params){
			// summary:
			//		Constructs a ViewBase instance.
			// params:
			//		view parameters, include:
			//
			//		- app: the app
			//		- id: view id
			//		- name: view name
			//		- parent: parent view
			//		- controller: view controller module identifier
			//		- children: children views
			this.id = "";
			this.name = "";
			this.children = {};
			this.selectedChildren = {};
			this.loadedStores = {};
			// private
			this._started = false;
			lang.mixin(this, params);
			// mixin views configuration to current view instance.
			if(this.parent.views){
				lang.mixin(this, this.parent.views[this.name]);
			}
		},

		// start view
		start: function(){
			// summary:
			//		start view object.
			//		load view template, view controller implement and startup all widgets in view template.
			if(this._started){
				return this;
			}
			this._startDef = new Deferred();
			when(this.load(), lang.hitch(this, function(){
				// call setupModel, after setupModel startup will be called after startup the loadViewDeferred will be resolved
				this._createDataStore(this);
				this._setupModel();
			}));
			return this._startDef;
		},

		load: function(){
			var vcDef = this._loadViewController();
			when(vcDef, lang.hitch(this, function(controller){
				if(controller){
					lang.mixin(this, controller);
				}
			}));
			return vcDef;
		},

		_createDataStore: function(){
			// summary:
			//		Create data store instance for View specific stores
			//
			// TODO: move this into a common place for use by main and ViewBase
			//
			if(this.parent.loadedStores){
				lang.mixin(this.loadedStores, this.parent.loadedStores);
			}

			if(this.stores){
				//create stores in the configuration.
				for(var item in this.stores){
					if(item.charAt(0) !== "_"){//skip the private properties
						var type = this.stores[item].type ? this.stores[item].type : "dojo/store/Memory";
						var config = {};
						if(this.stores[item].params){
							lang.mixin(config, this.stores[item].params);
						}
						// we assume the store is here through dependencies
						try{
							var storeCtor = require(type);
						}catch(e){
							throw new Error(type+" must be listed in the dependencies");
						}
						if(config.data && lang.isString(config.data)){
							//get the object specified by string value of data property
							//cannot assign object literal or reference to data property
							//because json.ref will generate __parent to point to its parent
							//and will cause infinitive loop when creating StatefulModel.
							config.data = lang.getObject(config.data);
						}
						if(this.stores[item].observable){
							try{
								var observableCtor = require("dojo/store/Observable");
							}catch(e){
								throw new Error("dojo/store/Observable must be listed in the dependencies");
							}
							this.stores[item].store = observableCtor(new storeCtor(config));
						}else{
							this.stores[item].store = new storeCtor(config);
						}
						this.loadedStores[item] = this.stores[item].store; // add this store to loadedStores for the view							
					}
				}
			}
		},

		_setupModel: function(){
			// summary:
			//		Load views model if it is not already loaded then call _startup.
			// tags:
			//		private
						
			if(!this.loadedModels){
				var createPromise;
				try{
					createPromise = model(this.models, this.parent, this.app);
				}catch(e){
					throw new Error("Error creating models: "+e.message);
				}
				when(createPromise, lang.hitch(this, function(models){
					if(models){
						// if models is an array it comes from dojo/promise/all. Each array slot contains the same result object
						// so pick slot 0.
						this.loadedModels = lang.isArray(models)?models[0]:models;
					}
					this._startup();
				}),
				function(err){
					throw new Error("Error creating models: "+err.message);					
				});
			}else{ // loadedModels already created so call _startup
				this._startup();				
			}		
		},

		_startup: function(){
			// summary:
			//		startup widgets in view template.
			// tags:
			//		private

			this._startLayout();			
		},

		_startLayout: function(){
			// summary:
			//		startup widgets in view template.
			// tags:
			//		private
			this.app.log("  > in app/ViewBase _startLayout firing layout for name=[",this.name,"], parent.name=[",this.parent.name,"]");

			if(!this.hasOwnProperty("constraint")){
				this.constraint = domAttr.get(this.domNode, "data-app-constraint") || "center";
			}
			constraints.register(this.constraint);


			this.app.emit("app-initLayout", {
				"view": this, 
				"callback": lang.hitch(this, function(){
						//start widget
						this.startup();

						// call view assistant's init() method to initialize view
						this.app.log("  > in app/ViewBase calling init() name=[",this.name,"], parent.name=[",this.parent.name,"]");
						this.init();
						this._started = true;
						if(this._startDef){
							this._startDef.resolve(this);
						}
				})
			});
		},


		_loadViewController: function(){
			// summary:
			//		Load view controller by configuration or by default.
			// tags:
			//		private
			//
			var viewControllerDef = new Deferred();
			var path;

			if(!this.controller){ // no longer using this.controller === "none", if we dont have one it means none.
				this.app.log("  > in app/ViewBase _loadViewController no controller set for view name=[",this.name,"], parent.name=[",this.parent.name,"]");
				viewControllerDef.resolve(true);
				return viewControllerDef;
			}else{
				path = this.controller.replace(/(\.js)$/, "");
			}

			var requireSignal;
			try{
				var loadFile = path;
				var index = loadFile.indexOf("./");
				if(index >= 0){
					loadFile = path.substring(index+2);
				}
				requireSignal = require.on("error", function(error){
					if(viewControllerDef.isResolved() || viewControllerDef.isRejected()){
						return;
					}
					if(error.info[0] && (error.info[0].indexOf(loadFile) >= 0)){
						viewControllerDef.resolve(false);
						requireSignal.remove();
					}
				});

				if(path.indexOf("./") == 0){
					path = "app/"+path;
				}

				require([path], function(controller){
					viewControllerDef.resolve(controller);
					requireSignal.remove();
				});
			}catch(e){
				viewControllerDef.reject(e);
				if(requireSignal){
					requireSignal.remove();
				}
			}
			return viewControllerDef;
		},

		init: function(){
			// summary:
			//		view life cycle init()
		},

		beforeActivate: function(){
			// summary:
			//		view life cycle beforeActivate()
		},

		afterActivate: function(){
			// summary:
			//		view life cycle afterActivate()
		},

		beforeDeactivate: function(){
			// summary:
			//		view life cycle beforeDeactivate()
		},

		afterDeactivate: function(){
			// summary:
			//		view life cycle afterDeactivate()
		},

		destroy: function(){
			// summary:
			//		view life cycle destroy()
		}
	});
});

},
'app/views/view1/view1Ctrl':function(){
/*jslint nomen: true */
/*jshint nomen: true */
/*global _, define, console, alert */
define([
    'dojo/_base/declare',
    'dojo/query!css3',
    'dojo/on',
    'dojox/mobile/ListItem',
    'dojo/NodeList-manipulate'
    // Load dojo/NodeList-manipulate to get JQuery syntax:
    //  html: function(/*String|DOMNode|NodeList?*/ value)
    //  text: function(/*String*/value)
    //  val: function(/*String||Array*/value)
    //  append: function(/*String||DOMNode||NodeList*/content)
    //  appendTo: function(/*String*/query)
    //  prepend: function(/*String||DOMNode||NodeList*/content)
    //  prependTo: function(/*String*/query)
    //  after: function(/*String||Element||NodeList*/content)
    //  insertAfter: function(/*String*/query)
    //  before: function(/*String||DOMNode||NodeList*/content)
    //  insertBefore: function(/*String*/query)
    //  return this._placeMultiple(query, "before")
    //  wrap: function(/*String||DOMNode*/html)
    //  wrapAll: function(/*String||DOMNode*/html)
    //  wrapInner: function(/*String||DOMNode*/html)
    //  replaceAll: function(/*String*/query)
    //  clone: function()
], function (declare, $, on, ListItem) {
    'use strict';

    var handles,
        viewNode,
        count = 0,
        DataListItem = declare(ListItem, {
            target: "requestItemDetails"
        });



    return {
        DataListItem: DataListItem,

        init: function (params) {
            // summary:
            //      view life cycle init()
            console.log(this.name + " view:init()");

            //save the view node in clousure to use as scope for dom manipulatation and query
            viewNode = this.domNode;

        },

        beforeActivate: function (view, data) {
            // summary:
            //      view life cycle beforeActivate()
            console.log(this.name + " view:beforeActivate(view,data)");
        },

        afterActivate: function (view, data) {
            // summary:
            //      view life cycle afterActivate()
            console.log(this.name + " view:afterActivate(view,data)");
            //Atach onclick event to fire once
            // TIP: Always scope your query selector to the View using viewNode
            on.once($("#doSomethingOnce", viewNode), "click", this.doSomething);
            //If using jquery the syntaxt will be: $("#doSomethingOnce", viewNode).one("click",this.doSomething)
            //$("#doSomethingOnce",viewNode).one("click", this.doSomething);
            count = 0;

            //Use jquery syntax here .val() and .sytle() depends on loading dojo/NodeList-manipulate
            $('input[type="text"]', viewNode).val("iddle").style("color", "red");

        },

        beforeDeactivate: function (view, data) {
            // summary:
            //      view life cycle beforeDeactivate()
            console.log(this.name + " view:beforeDeactivate(view,data)");
        },

        afterDeactivate: function (view, data) {
            // summary:
            //      view life cycle afterDeactivate()
            console.log(this.name + " view:afterDeactivate(view,data)");
        },

        destroy: function (params) {
            // summary:
            //      view life cycle destroy()
            console.log(this.name + " view:destory()");
        },
        /*****
         * Custom Code for View Controller
         *****/

        // JavaScript Primitives
        'aNumber'    : 42,
        'aString'    : 'Normal String',
        'aStringScapedQuotes'    : 'Got to View 2:<a href="index.html#view2">click</a>',
        'aBoolean'   : true,
        'aNull'      : null,

        _formatterTmpl : function (value, key) {
            // summary:
            //      Use to format template properties using the convention ${foo:_formatterTmpl}
            if (value === null) {
                return "null";
            }
            if (key === "aString") {
                return this.nls.view1_hello;
            }

            return value;

        },
        doSomething: function (event) {
            console.log('did something');
            // TIP: Always scope your query selector to the View using viewNode
            //Use jquery syntax here .val() and .sytle() depends on loading dojo/NodeList-manipulate
            $('input[type="text"]', viewNode).val("did something " + count);
            count = count + 1;
        }
    };
});

},
'dojox/mobile/ListItem':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"dojo/dom-attr",
	"dijit/registry",
	"dijit/_WidgetBase",
	"./iconUtils",
	"./_ItemBase",
	"./ProgressIndicator",
	"dojo/has",
	"dojo/has!dojo-bidi?dojox/mobile/bidi/ListItem"
], function(array, declare, lang, domClass, domConstruct, domStyle, domAttr, registry, WidgetBase, iconUtils, ItemBase, ProgressIndicator, has,  BidiListItem){

	// module:
	//		dojox/mobile/ListItem

	var ListItem = declare(has("dojo-bidi") ? "dojox.mobile.NonBidiListItem" : "dojox.mobile.ListItem", ItemBase, {
		// summary:
		//		An item of either RoundRectList or EdgeToEdgeList.
		// description:
		//		ListItem represents an item of either RoundRectList or
		//		EdgeToEdgeList. There are three ways to move to a different view:
		//		moveTo, href, and url. You can choose only one of them.
		//
		//		A child DOM node (or widget) can have the layout attribute,
		//		whose value is "left", "right", or "center". Such nodes will be
		//		aligned as specified.
		// example:
		// |	<li data-dojo-type="dojox.mobile.ListItem">
		// |		<div layout="left">Left Node</div>
		// |		<div layout="right">Right Node</div>
		// |		<div layout="center">Center Node</div>
		// |	</li>
		//
		//		Note that even if you specify variableHeight="true" for the list
		//		and place a tall object inside the layout node as in the example
		//		below, the layout node does not expand as you may expect,
		//		because layout node is aligned using float:left, float:right, or
		//		position:absolute.
		// example:
		// |	<li data-dojo-type="dojox.mobile.ListItem" variableHeight="true">
		// |		<div layout="left"><img src="large-picture.jpg"></div>
		// |	</li>

		// rightText: String
		//		A right-aligned text to display on the item.
		rightText: "",

		// rightIcon: String
		//		An icon to display at the right hand side of the item. The value
		//		can be either a path for an image file or a class name of a DOM
		//		button.
		rightIcon: "",

		// rightIcon2: String
		//		An icon to display at the left of the rightIcon. The value can
		//		be either a path for an image file or a class name of a DOM
		//		button.
		rightIcon2: "",

		// deleteIcon: String
		//		A delete icon to display at the left of the item. The value can
		//		be either a path for an image file or a class name of a DOM
		//		button.
		deleteIcon: "",

		// anchorLabel: Boolean
		//		If true, the label text becomes a clickable anchor text. When
		//		the user clicks on the text, the onAnchorLabelClicked handler is
		//		called. You can override or connect to the handler and implement
		//		any action. The handler has no default action.
		anchorLabel: false,

		// noArrow: Boolean
		//		If true, the right hand side arrow is not displayed.
		noArrow: false,

		// checked: Boolean
		//		If true, a check mark is displayed at the right of the item.
		checked: false,

		// arrowClass: String
		//		An icon to display as an arrow. The value can be either a path
		//		for an image file or a class name of a DOM button.
		arrowClass: "",

		// checkClass: String
		//		An icon to display as a check mark. The value can be either a
		//		path for an image file or a class name of a DOM button.
		checkClass: "",

		// uncheckClass: String
		//		An icon to display as an uncheck mark. The value can be either a
		//		path for an image file or a class name of a DOM button.
		uncheckClass: "",

		// variableHeight: Boolean
		//		If true, the height of the item varies according to its content.
		variableHeight: false,

		// rightIconTitle: String
		//		An alt text for the right icon.
		rightIconTitle: "",

		// rightIcon2Title: String
		//		An alt text for the right icon2.
		rightIcon2Title: "",

		// header: Boolean
		//		If true, this item is rendered as a category header.
		header: false,

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "li",

		// busy: Boolean
		//		If true, a progress indicator spins.
		busy: false,

		// progStyle: String
		//		A css class name to add to the progress indicator.
		progStyle: "",

		/* internal properties */	
		// The following properties are overrides of those in _ItemBase.
		paramsToInherit: "variableHeight,transition,deleteIcon,icon,rightIcon,rightIcon2,uncheckIcon,arrowClass,checkClass,uncheckClass,deleteIconTitle,deleteIconRole",
		baseClass: "mblListItem",

		_selStartMethod: "touch",
		_selEndMethod: "timer",
		_delayedSelection: true,

		_selClass: "mblListItemSelected",

		buildRendering: function(){
			this._templated = !!this.templateString; // true if this widget is templated
			if(!this._templated){
				// Create root node if it wasn't created by _TemplatedMixin
				this.domNode = this.containerNode = this.srcNodeRef || domConstruct.create(this.tag);
			}
			this.inherited(arguments);

			if(this.selected){
				domClass.add(this.domNode, this._selClass);
			}
			if(this.header){
				domClass.replace(this.domNode, "mblEdgeToEdgeCategory", this.baseClass);
			}

			if(!this._templated){
				this.labelNode =
					domConstruct.create("div", {className:"mblListItemLabel"});
				var ref = this.srcNodeRef;
				if(ref && ref.childNodes.length === 1 && ref.firstChild.nodeType === 3){
					// if ref has only one text node, regard it as a label
					this.labelNode.appendChild(ref.firstChild);
				}
				this.domNode.appendChild(this.labelNode);
			}
			this._layoutChildren = [];
		},

		startup: function(){
			if(this._started){ return; }
			var parent = this.getParent();
			var opts = this.getTransOpts();
			// When using a template, labelNode may be created via an attach point.
			// The attach points are not yet set when ListItem.buildRendering() 
			// executes, hence the need to use them in startup().
			if((!this._templated || this.labelNode) && this.anchorLabel){
				this.labelNode.style.display = "inline"; // to narrow the text region
				this.labelNode.style.cursor = "pointer";
				this.connect(this.labelNode, "onclick", "_onClick");
				this.onTouchStart = function(e){
					return (e.target !== this.labelNode);
				};
			}
			if(opts.moveTo || opts.href || opts.url || this.clickable || (parent && parent.select)){
				this.connect(this.domNode, "onkeydown", "_onClick"); // for desktop browsers
			}else{
				this._handleClick = false;
			}

			this.inherited(arguments);
			
			if(domClass.contains(this.domNode, "mblVariableHeight")){
				this.variableHeight = true;
			}
			if(this.variableHeight){
				domClass.add(this.domNode, "mblVariableHeight");
				this.defer("layoutVariableHeight");
			}

			if(!this._isOnLine){
				this._isOnLine = true;
				this.set({ 
					// retry applying the attributes for which the custom setter delays the actual 
					// work until _isOnLine is true
					icon: this._pending_icon !== undefined ? this._pending_icon : this.icon,
					deleteIcon: this._pending_deleteIcon !== undefined ? this._pending_deleteIcon : this.deleteIcon,
					rightIcon: this._pending_rightIcon !== undefined ? this._pending_rightIcon : this.rightIcon,
					rightIcon2: this._pending_rightIcon2 !== undefined ? this._pending_rightIcon2 : this.rightIcon2,
					uncheckIcon: this._pending_uncheckIcon !== undefined ? this._pending_uncheckIcon : this.uncheckIcon 
				});
				// Not needed anymore (this code executes only once per life cycle):
				delete this._pending_icon;
				delete this._pending_deleteIcon;
				delete this._pending_rightIcon;
				delete this._pending_rightIcon2;
				delete this._pending_uncheckIcon;
			}
			if(parent && parent.select){
				// retry applying the attributes for which the custom setter delays the actual 
				// work until _isOnLine is true. 
				this.set("checked", this._pendingChecked !== undefined ? this._pendingChecked : this.checked);
				domAttr.set(this.domNode, "role", "option");
				if(this._pendingChecked || this.checked){
					domAttr.set(this.domNode, "aria-selected", "true");
				}
				// Not needed anymore (this code executes only once per life cycle):
				delete this._pendingChecked; 
			}
			this.setArrow();
			this.layoutChildren();
		},

		_updateHandles: function(){
			// tags:
			//		private
			var parent = this.getParent();
			var opts = this.getTransOpts();
			if(opts.moveTo || opts.href || opts.url || this.clickable || (parent && parent.select)){
				if(!this._keydownHandle){
					this._keydownHandle = this.connect(this.domNode, "onkeydown", "_onClick"); // for desktop browsers
				}
				this._handleClick = true;
			}else{
				if(this._keydownHandle){
					this.disconnect(this._keydownHandle);
					this._keydownHandle = null;
				}
				this._handleClick = false;
			}
			this.inherited(arguments);
		},

		layoutChildren: function(){
			var centerNode;
			array.forEach(this.domNode.childNodes, function(n){
				if(n.nodeType !== 1){ return; }
				var layout = n.getAttribute("layout") || // TODO: Remove the non-HTML5-compliant attribute in 2.0
					n.getAttribute("data-mobile-layout") || 
					(registry.byNode(n) || {}).layout;
				if(layout){ 
					domClass.add(n, "mblListItemLayout" +
						layout.charAt(0).toUpperCase() + layout.substring(1));
					this._layoutChildren.push(n);
					if(layout === "center"){ centerNode = n; }
				}
			}, this);
			if(centerNode){
				this.domNode.insertBefore(centerNode, this.domNode.firstChild);
			}
		},

		resize: function(){
			if(this.variableHeight){
				this.layoutVariableHeight();
			}

			// labelNode may not exist only when using a template (if not created by an attach point)
			if(!this._templated || this.labelNode){
				// If labelNode is empty, shrink it so as not to prevent user clicks.
				this.labelNode.style.display = this.labelNode.firstChild ? "block" : "inline";
			}
		},

		_onTouchStart: function(e){
			// tags:
			//		private
			if(e.target.getAttribute("preventTouch") || // TODO: Remove the non-HTML5-compliant attribute in 2.0
				e.target.getAttribute("data-mobile-prevent-touch") ||
				(registry.getEnclosingWidget(e.target) || {}).preventTouch){
				return;
			}
			this.inherited(arguments);
		},

		_onClick: function(e){
			// summary:
			//		Internal handler for click events.
			// tags:
			//		private
			if(this.getParent().isEditing || e && e.type === "keydown" && e.keyCode !== 13){ return; }
			if(this.onClick(e) === false){ return; } // user's click action
			var n = this.labelNode;
			// labelNode may not exist only when using a template 
			if((this._templated || n) && this.anchorLabel && e.currentTarget === n){
				domClass.add(n, "mblListItemLabelSelected");
				this.defer(function(){
					domClass.remove(n, "mblListItemLabelSelected");
				}, this._duration);
				this.onAnchorLabelClicked(e);
				return;
			}
			var parent = this.getParent();
			if(parent.select){
				if(parent.select === "single"){
					if(!this.checked){
						this.set("checked", true);
					}
				}else if(parent.select === "multiple"){
					this.set("checked", !this.checked);
				}
			}
			this.defaultClickAction(e);
		},

		onClick: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User-defined function to handle clicks.
			// tags:
			//		callback
		},

		onAnchorLabelClicked: function(e){
			// summary:
			//		Stub function to connect to from your application.
		},

		layoutVariableHeight: function(){
			// summary:
			//		Lays out the current item with variable height.
			var h = this.domNode.offsetHeight;
			if(h === this.domNodeHeight){ return; }
			this.domNodeHeight = h;
			array.forEach(this._layoutChildren.concat([
				this.rightTextNode,
				this.rightIcon2Node,
				this.rightIconNode,
				this.uncheckIconNode,
				this.iconNode,
				this.deleteIconNode,
				this.knobIconNode
			]), function(n){
				if(n){
					var domNode = this.domNode;
					var f = function(){
						var t = Math.round((domNode.offsetHeight - n.offsetHeight) / 2) -
							domStyle.get(domNode, "paddingTop");
						n.style.marginTop = t + "px";
					}
					if(n.offsetHeight === 0 && n.tagName === "IMG"){
						n.onload = f;
					}else{
						f();
					}
				}
			}, this);
		},

		setArrow: function(){
			// summary:
			//		Sets the arrow icon if necessary.
			if(this.checked){ return; }
			var c = "";
			var parent = this.getParent();
			var opts = this.getTransOpts();
			if(opts.moveTo || opts.href || opts.url || this.clickable){
				if(!this.noArrow && !(parent && parent.selectOne)){
					c = this.arrowClass || "mblDomButtonArrow";
					domAttr.set(this.domNode, "role", "button");
				}
			}
			if(c){
				this._setRightIconAttr(c);
			}
		},

		_findRef: function(/*String*/type){
			// summary:
			//		Find an appropriate position to insert a new child node.
			// tags:
			//		private
			var i, node, list = ["deleteIcon", "icon", "rightIcon", "uncheckIcon", "rightIcon2", "rightText"];
			for(i = array.indexOf(list, type) + 1; i < list.length; i++){
				node = this[list[i] + "Node"];
				if(node){ return node; }
			}
			for(i = list.length - 1; i >= 0; i--){
				node = this[list[i] + "Node"];
				if(node){ return node.nextSibling; }
			}
			return this.domNode.firstChild;
		},
		
		_setIcon: function(/*String*/icon, /*String*/type){
			// tags:
			//		private
			if(!this._isOnLine){
				// record the value to be able to reapply it (see the code in the startup method)
				this["_pending_" + type] = icon;
				return; 
			} // icon may be invalid because inheritParams is not called yet
			this._set(type, icon);
			this[type + "Node"] = iconUtils.setIcon(icon, this[type + "Pos"],
				this[type + "Node"], this[type + "Title"] || this.alt, this.domNode, this._findRef(type), "before");
			if(this[type + "Node"]){
				var cap = type.charAt(0).toUpperCase() + type.substring(1);
				domClass.add(this[type + "Node"], "mblListItem" + cap);
			}
			var role = this[type + "Role"];
			if(role){
				this[type + "Node"].setAttribute("role", role);
			}
		},

		_setDeleteIconAttr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "deleteIcon");
		},

		_setIconAttr: function(icon){
			// tags:
			//		private
			this._setIcon(icon, "icon");
		},

		_setRightTextAttr: function(/*String*/text){
			// tags:
			//		private
			if(!this._templated && !this.rightTextNode){
				// When using a template, let the template create the element.
				this.rightTextNode = domConstruct.create("div", {className:"mblListItemRightText"}, this.labelNode, "before");
			}
			this.rightText = text;
			this.rightTextNode.innerHTML = this._cv ? this._cv(text) : text;
		},

		_setRightIconAttr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "rightIcon");
		},

		_setUncheckIconAttr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "uncheckIcon");
		},

		_setRightIcon2Attr: function(/*String*/icon){
			// tags:
			//		private
			this._setIcon(icon, "rightIcon2");
		},

		_setCheckedAttr: function(/*Boolean*/checked){
			// tags:
			//		private
			if(!this._isOnLine){
				// record the value to be able to reapply it (see the code in the startup method)
				this._pendingChecked = checked; 
				return; 
			} // icon may be invalid because inheritParams is not called yet
			var parent = this.getParent();
			if(parent && parent.select === "single" && checked){
				array.forEach(parent.getChildren(), function(child){
					child !== this && child.checked && child.set("checked", false) && domAttr.set(child.domNode, "aria-selected", "false");
				}, this);
			}
			this._setRightIconAttr(this.checkClass || "mblDomButtonCheck");
			this._setUncheckIconAttr(this.uncheckClass);

			domClass.toggle(this.domNode, "mblListItemChecked", checked);
			domClass.toggle(this.domNode, "mblListItemUnchecked", !checked);
			domClass.toggle(this.domNode, "mblListItemHasUncheck", !!this.uncheckIconNode);
			this.rightIconNode.style.position = (this.uncheckIconNode && !checked) ? "absolute" : "";

			if(parent && this.checked !== checked){
				parent.onCheckStateChanged(this, checked);
			}
			this._set("checked", checked);
			domAttr.set(this.domNode, "aria-selected", checked ? "true" : "false");
		},

		_setBusyAttr: function(/*Boolean*/busy){
			// tags:
			//		private
			var prog = this._prog;
			if(busy){
				if(!this._progNode){
					this._progNode = domConstruct.create("div", {className:"mblListItemIcon"});
					prog = this._prog = new ProgressIndicator({size:25, center:false, removeOnStop:false});
					domClass.add(prog.domNode, this.progStyle);
					this._progNode.appendChild(prog.domNode);
				}
				if(this.iconNode){
					this.domNode.replaceChild(this._progNode, this.iconNode);
				}else{
					domConstruct.place(this._progNode, this._findRef("icon"), "before");
				}
				prog.start();
			}else if(this._progNode){
				if(this.iconNode){
					this.domNode.replaceChild(this.iconNode, this._progNode);
				}else{
					this.domNode.removeChild(this._progNode);
				}
				prog.stop();
			}
			this._set("busy", busy);
		},

		_setSelectedAttr: function(/*Boolean*/selected){
			// summary:
			//		Makes this widget in the selected or unselected state.
			// tags:
			//		private
			this.inherited(arguments);
			domClass.toggle(this.domNode, this._selClass, selected);
		},
		
		_setClickableAttr: function(/*Boolean*/clickable){
			// tags:
			//		private
			this._set("clickable", clickable);
			this._updateHandles();
		},
		
		_setMoveToAttr: function(/*String*/moveTo){
			// tags:
			//		private
			this._set("moveTo", moveTo);
			this._updateHandles();
		},
		
		_setHrefAttr: function(/*String*/href){
			// tags:
			//		private
			this._set("href", href);
			this._updateHandles();
		},
		
		_setUrlAttr: function(/*String*/url){
			// tags:
			//		private
			this._set("url", url);
			this._updateHandles();
		}
	});
	
	ListItem.ChildWidgetProperties = {
		// summary:
		//		These properties can be specified for the children of a dojox/mobile/ListItem.

		// layout: String
		//		Specifies the position of the ListItem child ("left", "center" or "right").
		layout: "",

		// preventTouch: Boolean
		//		Disables touch events on the ListItem child.
		preventTouch: false
	};
	
	// Since any widget can be specified as a ListItem child, mix ChildWidgetProperties
	// into the base widget class.  (This is a hack, but it's effective.)
	// This is for the benefit of the parser.   Remove for 2.0.  Also, hide from doc viewer.
	lang.extend(WidgetBase, /*===== {} || =====*/ ListItem.ChildWidgetProperties);

	return has("dojo-bidi") ? declare("dojox.mobile.ListItem", [ListItem, BidiListItem]) : ListItem;	
});

},
'dojox/mobile/iconUtils':function(){
define([
	"dojo/_base/array",
	"dojo/_base/config",
	"dojo/_base/connect",
	"dojo/_base/event",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-style",
	"./sniff"
], function(array, config, connect, event, lang, win, domClass, domConstruct, domStyle, has){

	var dm = lang.getObject("dojox.mobile", true);

	// module:
	//		dojox/mobile/iconUtils

	var IconUtils = function(){
		// summary:
		//		Utilities to create an icon (image, CSS sprite image, or DOM Button).

		this.setupSpriteIcon = function(/*DomNode*/iconNode, /*String*/iconPos){
			// summary:
			//		Sets up CSS sprite for a foreground image.
			if(iconNode && iconPos){
				var arr = array.map(iconPos.split(/[ ,]/),function(item){return item-0});
				var t = arr[0]; // top
				var r = arr[1] + arr[2]; // right
				var b = arr[0] + arr[3]; // bottom
				var l = arr[1]; // left
				domStyle.set(iconNode, {
					position: "absolute",
					clip: "rect("+t+"px "+r+"px "+b+"px "+l+"px)",
					top: (iconNode.parentNode ? domStyle.get(iconNode, "top") : 0) - t + "px",
					left: -l + "px"
				});
				domClass.add(iconNode, "mblSpriteIcon");
			}
		};

		this.createDomButton = function(/*DomNode*/refNode, /*Object?*/style, /*DomNode?*/toNode){
			// summary:
			//		Creates a DOM button.
			// description:
			//		DOM button is a simple graphical object that consists of one or
			//		more nested DIV elements with some CSS styling. It can be used
			//		in place of an icon image on ListItem, IconItem, and so on.
			//		The kind of DOM button to create is given as a class name of
			//		refNode. The number of DIVs to create is searched from the style
			//		sheets in the page. However, if the class name has a suffix that
			//		starts with an underscore, like mblDomButtonGoldStar_5, then the
			//		suffixed number is used instead. A class name for DOM button
			//		must starts with 'mblDomButton'.
			// refNode:
			//		A node that has a DOM button class name.
			// style:
			//		A hash object to set styles to the node.
			// toNode:
			//		A root node to create a DOM button. If omitted, refNode is used.

			if(!this._domButtons){
				if(has("webkit")){
					var findDomButtons = function(sheet, dic){
						// summary:
						//		Searches the style sheets for DOM buttons.
						// description:
						//		Returns a key-value pair object whose keys are DOM
						//		button class names and values are the number of DOM
						//		elements they need.
						var i, j;
						if(!sheet){
							var _dic = {};
							var ss = win.doc.styleSheets;
							for (i = 0; i < ss.length; i++){
								ss[i] && findDomButtons(ss[i], _dic);
							}
							return _dic;
						}
						var rules = sheet.cssRules || [];
						for (i = 0; i < rules.length; i++){
							var rule = rules[i];
							if(rule.href && rule.styleSheet){
								findDomButtons(rule.styleSheet, dic);
							}else if(rule.selectorText){
								var sels = rule.selectorText.split(/,/);
								for (j = 0; j < sels.length; j++){
									var sel = sels[j];
									var n = sel.split(/>/).length - 1;
									if(sel.match(/(mblDomButton\w+)/)){
										var cls = RegExp.$1;
										if(!dic[cls] || n > dic[cls]){
											dic[cls] = n;
										}
									}
								}
							}
						}
						return dic;
					}
					this._domButtons = findDomButtons();
				}else{
					this._domButtons = {};
				}
			}

			var s = refNode.className;
			var node = toNode || refNode;
			if(s.match(/(mblDomButton\w+)/) && s.indexOf("/") === -1){
				var btnClass = RegExp.$1;
				var nDiv = 4;
				if(s.match(/(mblDomButton\w+_(\d+))/)){
					nDiv = RegExp.$2 - 0;
				}else if(this._domButtons[btnClass] !== undefined){
					nDiv = this._domButtons[btnClass];
				}
				var props = null;
				if(has("bb") && config["mblBBBoxShadowWorkaround"] !== false){
					// Removes box-shadow because BlackBerry incorrectly renders it.
					props = {style:"-webkit-box-shadow:none"};
				}
				for(var i = 0, p = node; i < nDiv; i++){
					p = p.firstChild || domConstruct.create("div", props, p);
				}
				if(toNode){
					setTimeout(function(){
						domClass.remove(refNode, btnClass);
					}, 0);
					domClass.add(toNode, btnClass);
				}
			}else if(s.indexOf(".") !== -1){ // file name
				domConstruct.create("img", {src:s}, node);
			}else{
				return null;
			}
			domClass.add(node, "mblDomButton");
			!!style && domStyle.set(node, style);
			return node;
		};

		this.createIcon = function(/*String*/icon, /*String?*/iconPos, /*DomNode?*/node, /*String?*/title, /*DomNode?*/parent, /*DomNode?*/refNode, /*String?*/pos){
			// summary:
			//		Creates or updates an icon node
			// description:
			//		If node exists, updates the existing node. Otherwise, creates a new one.
			// icon:
			//		Path for an image, or DOM button class name.
			title = title || "";
			if(icon && icon.indexOf("mblDomButton") === 0){
				// DOM button
				if(!node){
					node = domConstruct.create("div", null, refNode || parent, pos);
				}else{
					if(node.className.match(/(mblDomButton\w+)/)){
						domClass.remove(node, RegExp.$1);
					}
				}
				node.title = title;
				domClass.add(node, icon);
				this.createDomButton(node);
			}else if(icon && icon !== "none"){
				// Image
				if(!node || node.nodeName !== "IMG"){
					node = domConstruct.create("img", {
						alt: title
					}, refNode || parent, pos);
				}
				node.src = (icon || "").replace("${theme}", dm.currentTheme);
				this.setupSpriteIcon(node, iconPos);
				if(iconPos && parent){
					var arr = iconPos.split(/[ ,]/);
					domStyle.set(parent, {
						position: "relative",
						width: arr[2] + "px",
						height: arr[3] + "px"
					});
					domClass.add(parent, "mblSpriteIconParent");
				}
				connect.connect(node, "ondragstart", event, "stop");
			}
			return node;
		};

		this.iconWrapper = false;
		this.setIcon = function(/*String*/icon, /*String*/iconPos, /*DomNode*/iconNode, /*String?*/alt, /*DomNode*/parent, /*DomNode?*/refNode, /*String?*/pos){
			// summary:
			//		A setter function to set an icon.
			// description:
			//		This function is intended to be used by icon setters (e.g. _setIconAttr)
			// icon:
			//		An icon path or a DOM button class name.
			// iconPos:
			//		The position of an aggregated icon. IconPos is comma separated
			//		values like top,left,width,height (ex. "0,0,29,29").
			// iconNode:
			//		An icon node.
			// alt:
			//		An alt text for the icon image.
			// parent:
			//		Parent node of the icon.
			// refNode:
			//		A node reference to place the icon.
			// pos:
			//		The position of the icon relative to refNode.
			if(!parent || !icon && !iconNode){ return null; }
			if(icon && icon !== "none"){ // create or update an icon
				if(!this.iconWrapper && icon.indexOf("mblDomButton") !== 0 && !iconPos){ // image
					if(iconNode && iconNode.tagName === "DIV"){
						domConstruct.destroy(iconNode);
						iconNode = null;
					}
					iconNode = this.createIcon(icon, null, iconNode, alt, parent, refNode, pos);
					domClass.add(iconNode, "mblImageIcon");
				}else{ // sprite or DOM button
					if(iconNode && iconNode.tagName === "IMG"){
						domConstruct.destroy(iconNode);
						iconNode = null;
					}
					iconNode && domConstruct.empty(iconNode);
					if(!iconNode){
						iconNode = domConstruct.create("div", null, refNode || parent, pos);
					}
					this.createIcon(icon, iconPos, null, null, iconNode);
					if(alt){
						iconNode.title = alt;
					}
				}
				domClass.remove(parent, "mblNoIcon");
				return iconNode;
			}else{ // clear the icon
				domConstruct.destroy(iconNode);
				domClass.add(parent, "mblNoIcon");
				return null;
			}
		};
	};

	// Return singleton.  (TODO: can we replace IconUtils class and singleton w/a simple hash of functions?)
	return new IconUtils();
});

},
'dojox/mobile/_ItemBase':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-class",
	"dojo/touch",
	"dijit/registry",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase",
	"./TransitionEvent",
	"./iconUtils",
	"./sniff",
	"dojo/has!dojo-bidi?dojox/mobile/bidi/_ItemBase"
], function(array, declare, lang, win, domClass, touch, registry, Contained, Container, WidgetBase, TransitionEvent, iconUtils, has, BidiItemBase){

	// module:
	//		dojox/mobile/_ItemBase

	var _ItemBase = declare(has("dojo-bidi") ? "dojox.mobile._NonBidiItemBase" : "dojox.mobile._ItemBase", [WidgetBase, Container, Contained], {
		// summary:
		//		A base class for item classes (e.g. ListItem, IconItem, etc.).
		// description:
		//		_ItemBase is a base class for widgets that have capability to
		//		make a view transition when clicked.

		// icon: String
		//		An icon image to display. The value can be either a path for an
		//		image file or a class name of a DOM button. If icon is not
		//		specified, the iconBase parameter of the parent widget is used.
		icon: "",

		// iconPos: String
		//		The position of an aggregated icon. IconPos is comma separated
		//		values like top,left,width,height (ex. "0,0,29,29"). If iconPos
		//		is not specified, the iconPos parameter of the parent widget is
		//		used.
		iconPos: "", // top,left,width,height (ex. "0,0,29,29")

		// alt: String
		//		An alternate text for the icon image.
		alt: "",

		// href: String
		//		A URL of another web page to go to.
		href: "",

		// hrefTarget: String
		//		A target that specifies where to open a page specified by
		//		href. The value will be passed to the 2nd argument of
		//		window.open().
		hrefTarget: "",

		// moveTo: String
		//		The id of the transition destination view which resides in the
		//		current page.
		//
		//		If the value has a hash sign ('#') before the id (e.g. #view1)
		//		and the dojo/hash module is loaded by the user application, the
		//		view transition updates the hash in the browser URL so that the
		//		user can bookmark the destination view. In this case, the user
		//		can also use the browser's back/forward button to navigate
		//		through the views in the browser history.
		//
		//		If null, transitions to a blank view.
		//		If '#', returns immediately without transition.
		moveTo: "",

		// scene: String
		//		The name of a scene. Used from dojox/mobile/app.
		scene: "",

		// clickable: Boolean
		//		If true, this item becomes clickable even if a transition
		//		destination (moveTo, etc.) is not specified.
		clickable: false,

		// url: String
		//		A URL of an html fragment page or JSON data that represents a
		//		new view content. The view content is loaded with XHR and
		//		inserted in the current page. Then a view transition occurs to
		//		the newly created view. The view is cached so that subsequent
		//		requests would not load the content again.
		url: "",

		// urlTarget: String
		//		Node id under which a new view will be created according to the
		//		url parameter. If not specified, The new view will be created as
		//		a sibling of the current view.
		urlTarget: "",

		// back: Boolean
		//		If true, history.back() is called when clicked.
		back: false,

		// transition: String
		//		A type of animated transition effect. You can choose from the
		//		standard transition types, "slide", "fade", "flip", or from the
		//		extended transition types, "cover", "coverv", "dissolve",
		//		"reveal", "revealv", "scaleIn", "scaleOut", "slidev",
		//		"swirl", "zoomIn", "zoomOut", "cube", and "swap". If "none" is
		//		specified, transition occurs immediately without animation.
		transition: "",

		// transitionDir: Number
		//		The transition direction. If 1, transition forward. If -1,
		//		transition backward. For example, the slide transition slides
		//		the view from right to left when dir == 1, and from left to
		//		right when dir == -1.
		transitionDir: 1,

		// transitionOptions: Object
		//		A hash object that holds transition options.
		transitionOptions: null,

		// callback: Function|String
		//		A callback function that is called when the transition has been
		//		finished. A function reference, or name of a function in
		//		context.
		callback: null,

		// label: String
		//		A label of the item. If the label is not specified, innerHTML is
		//		used as a label.
		label: "",

		// toggle: Boolean
		//		If true, the item acts like a toggle button.
		toggle: false,

		// selected: Boolean
		//		If true, the item is highlighted to indicate it is selected.
		selected: false,

		// tabIndex: String
		//		Tabindex setting for the item so users can hit the tab key to
		//		focus on it.
		tabIndex: "0",
		
		// _setTabIndexAttr: [private] String
		//		Sets tabIndex to domNode.
		_setTabIndexAttr: "",

		/* internal properties */	

		// paramsToInherit: String
		//		Comma separated parameters to inherit from the parent.
		paramsToInherit: "transition,icon",

		// _selStartMethod: String
		//		Specifies how the item enters the selected state.
		//
		//		- "touch": Use touch events to enter the selected state.
		//		- "none": Do not change the selected state.
		_selStartMethod: "none", // touch or none

		// _selEndMethod: String
		//		Specifies how the item leaves the selected state.
		//
		//		- "touch": Use touch events to leave the selected state.
		//		- "timer": Use setTimeout to leave the selected state.
		//		- "none": Do not change the selected state.
		_selEndMethod: "none", // touch, timer, or none

		// _delayedSelection: Boolean
		//		If true, selection is delayed 100ms and canceled if dragged in
		//		order to avoid selection when flick operation is performed.
		_delayedSelection: false,

		// _duration: Number
		//		Duration of selection, milliseconds.
		_duration: 800,

		// _handleClick: Boolean
		//		If true, this widget listens to touch events.
		_handleClick: true,

		buildRendering: function(){
			this.inherited(arguments);
			this._isOnLine = this.inheritParams();
		},

		startup: function(){
			if(this._started){ return; }
			if(!this._isOnLine){
				this.inheritParams();
			}
			this._updateHandles();
			this.inherited(arguments);
		},

		inheritParams: function(){
			// summary:
			//		Copies from the parent the values of parameters specified 
			//		by the property paramsToInherit.
			var parent = this.getParent();
			if(parent){
				array.forEach(this.paramsToInherit.split(/,/), function(p){
					if(p.match(/icon/i)){
						var base = p + "Base", pos = p + "Pos";
						if(this[p] && parent[base] &&
							parent[base].charAt(parent[base].length - 1) === '/'){
							this[p] = parent[base] + this[p];
						}
						if(!this[p]){ this[p] = parent[base]; }
						if(!this[pos]){ this[pos] = parent[pos]; }
					}
					if(!this[p]){ this[p] = parent[p]; }
				}, this);
			}
			return !!parent;
		},

		_updateHandles: function(){
			// tags:
			//		private
			if(this._handleClick && this._selStartMethod === "touch"){
				if(!this._onTouchStartHandle){
					this._onTouchStartHandle = this.connect(this.domNode, touch.press, "_onTouchStart");
				}
			}else{
				if(this._onTouchStartHandle){
					this.disconnect(this._onTouchStartHandle);
					this._onTouchStartHandle = null;
				}
			}
		},
		
		getTransOpts: function(){
			// summary:
			//		Copies from the parent and returns the values of parameters  
			//		specified by the property paramsToInherit.
			var opts = this.transitionOptions || {};
			array.forEach(["moveTo", "href", "hrefTarget", "url", "target",
				"urlTarget", "scene", "transition", "transitionDir"], function(p){
				opts[p] = opts[p] || this[p];
			}, this);
			return opts; // Object
		},

		userClickAction: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User-defined click action.
		},

		defaultClickAction: function(/*Event*/e){
			// summary:
			//		The default action of this item.
			this.handleSelection(e);
			if(this.userClickAction(e) === false){ return; } // user's click action
			this.makeTransition(e);
		},

		handleSelection: function(/*Event*/e){
			// summary:
			//		Handles this items selection state.

			// Before transitioning, we want the visual effect of selecting the item.
			// To ensure this effect happens even if _delayedSelection is true:
			if(this._delayedSelection){
				this.set("selected", true);
			} // the item will be deselected after transition.

			if(this._onTouchEndHandle){
				this.disconnect(this._onTouchEndHandle);
				this._onTouchEndHandle = null;
			}

			var p = this.getParent();
			if(this.toggle){
				this.set("selected", !this._currentSel);
			}else if(p && p.selectOne){
				this.set("selected", true);
			}else{
				if(this._selEndMethod === "touch"){
					this.set("selected", false);
				}else if(this._selEndMethod === "timer"){
					this.defer(function(){
						this.set("selected", false);
					}, this._duration);
				}
			}
		},

		makeTransition: function(/*Event*/e){
			// summary:
			//		Makes a transition.
			if(this.back && history){
				history.back();	
				return;
			}	
			if (this.href && this.hrefTarget && this.hrefTarget != "_self") {
				win.global.open(this.href, this.hrefTarget || "_blank");
				this._onNewWindowOpened(e);
				return;
			}
			var opts = this.getTransOpts();
			var doTransition = 
				!!(opts.moveTo || opts.href || opts.url || opts.target || opts.scene);
			if(this._prepareForTransition(e, doTransition ? opts : null) === false){ return; }
			if(doTransition){
				this.setTransitionPos(e);
				new TransitionEvent(this.domNode, opts, e).dispatch();
			}
		},

		_onNewWindowOpened: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		Subclasses may want to implement it.
		},

		_prepareForTransition: function(/*Event*/e, /*Object*/transOpts){
			// summary:
			//		Subclasses may want to implement it.
		},

		_onTouchStart: function(e){
			// tags:
			//		private
			if(this.getParent().isEditing || this.onTouchStart(e) === false){ return; } // user's touchStart action
			if(!this._onTouchEndHandle && this._selStartMethod === "touch"){
				// Connect to the entire window. Otherwise, fail to receive
				// events if operation is performed outside this widget.
				// Expose both connect handlers in case the user has interest.
				this._onTouchMoveHandle = this.connect(win.body(), touch.move, "_onTouchMove");
				this._onTouchEndHandle = this.connect(win.body(), touch.release, "_onTouchEnd");
			}
			this.touchStartX = e.touches ? e.touches[0].pageX : e.clientX;
			this.touchStartY = e.touches ? e.touches[0].pageY : e.clientY;
			this._currentSel = this.selected;

			if(this._delayedSelection){
				// so as not to make selection when the user flicks on ScrollableView
				this._selTimer = this.defer(function(){
					this.set("selected", true);
				}, 100);
			}else{
				this.set("selected", true);
			}
		},

		onTouchStart: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		User-defined function to handle touchStart events.
			// tags:
			//		callback
		},

		_onTouchMove: function(e){
			// tags:
			//		private
			var x = e.touches ? e.touches[0].pageX : e.clientX;
			var y = e.touches ? e.touches[0].pageY : e.clientY;
			if(Math.abs(x - this.touchStartX) >= 4 ||
			   Math.abs(y - this.touchStartY) >= 4){ // dojox/mobile/scrollable.threshold
				this.cancel();
				var p = this.getParent();
				if(p && p.selectOne){
					this._prevSel && this._prevSel.set("selected", true);
				}else{
					this.set("selected", false);
				}
			}
		},

		_disconnect: function(){
			// tags:
			//		private
			this.disconnect(this._onTouchMoveHandle);
			this.disconnect(this._onTouchEndHandle);
			this._onTouchMoveHandle = this._onTouchEndHandle = null;
		},

		cancel: function(){
			// summary:
			//		Cancels an ongoing selection (if any).
			if(this._selTimer){
				this._selTimer.remove(); 
				this._selTimer = null;
			}
			this._disconnect();
		},

		_onTouchEnd: function(e){
			// tags:
			//		private
			if(!this._selTimer && this._delayedSelection){ return; }
			this.cancel();
			this._onClick(e);
		},

		setTransitionPos: function(e){
			// summary:
			//		Stores the clicked position for later use.
			// description:
			//		Some of the transition animations (e.g. ScaleIn) need the
			//		clicked position.
			var w = this;
			while(true){
				w = w.getParent();
				if(!w || domClass.contains(w.domNode, "mblView")){ break; }
			}
			if(w){
				w.clickedPosX = e.clientX;
				w.clickedPosY = e.clientY;
			}
		},

		transitionTo: function(/*String|Object*/moveTo, /*String*/href, /*String*/url, /*String*/scene){
			// summary:
			//		Performs a view transition.
			// description:
			//		Given a transition destination, this method performs a view
			//		transition. This method is typically called when this item
			//		is clicked.
			var opts = (moveTo && typeof(moveTo) === "object") ? moveTo :
				{moveTo: moveTo, href: href, url: url, scene: scene,
				 transition: this.transition, transitionDir: this.transitionDir};
			new TransitionEvent(this.domNode, opts).dispatch();
		},

		_setIconAttr: function(icon){
			// tags:
			//		private
			if(!this._isOnLine){
				// record the value to be able to reapply it (see the code in the startup method)
				this._pendingIcon = icon;  
				return; 
			} // icon may be invalid because inheritParams is not called yet
			this._set("icon", icon);
			this.iconNode = iconUtils.setIcon(icon, this.iconPos, this.iconNode, this.alt, this.iconParentNode, this.refNode, this.position);
		},

		_setLabelAttr: function(/*String*/text){
			// tags:
			//		private
			this._set("label", text);
			this.labelNode.innerHTML = this._cv ? this._cv(text) : text;
		},

		_setSelectedAttr: function(/*Boolean*/selected){
			// summary:
			//		Makes this widget in the selected or unselected state.
			// description:
			//		Subclass should override.
			// tags:
			//		private
			if(selected){
				var p = this.getParent();
				if(p && p.selectOne){
					// deselect the currently selected item
					var arr = array.filter(p.getChildren(), function(w){
						return w.selected;
					});
					array.forEach(arr, function(c){
						this._prevSel = c;
						c.set("selected", false);
					}, this);
				}
			}
			this._set("selected", selected);
		}
	});
	return has("dojo-bidi") ? declare("dojox.mobile._ItemBase", [_ItemBase, BidiItemBase]) : _ItemBase;
});

},
'dijit/_Contained':function(){
define([
	"dojo/_base/declare", // declare
	"./registry"	// registry.getEnclosingWidget(), registry.byNode()
], function(declare, registry){

	// module:
	//		dijit/_Contained

	return declare("dijit._Contained", null, {
		// summary:
		//		Mixin for widgets that are children of a container widget
		// example:
		//	|	// make a basic custom widget that knows about its parents
		//	|	declare("my.customClass",[dijit._WidgetBase, dijit._Contained],{});

		_getSibling: function(/*String*/ which){
			// summary:
			//		Returns next or previous sibling
			// which:
			//		Either "next" or "previous"
			// tags:
			//		private
			var node = this.domNode;
			do{
				node = node[which+"Sibling"];
			}while(node && node.nodeType != 1);
			return node && registry.byNode(node);	// dijit/_WidgetBase
		},

		getPreviousSibling: function(){
			// summary:
			//		Returns null if this is the first child of the parent,
			//		otherwise returns the next element sibling to the "left".

			return this._getSibling("previous"); // dijit/_WidgetBase
		},

		getNextSibling: function(){
			// summary:
			//		Returns null if this is the last child of the parent,
			//		otherwise returns the next element sibling to the "right".

			return this._getSibling("next"); // dijit/_WidgetBase
		},

		getIndexInParent: function(){
			// summary:
			//		Returns the index of this widget within its container parent.
			//		It returns -1 if the parent does not exist, or if the parent
			//		is not a dijit/_Container

			var p = this.getParent();
			if(!p || !p.getIndexOfChild){
				return -1; // int
			}
			return p.getIndexOfChild(this); // int
		}
	});
});

},
'dijit/_Container':function(){
define([
	"dojo/_base/array", // array.forEach array.indexOf
	"dojo/_base/declare", // declare
	"dojo/dom-construct", // domConstruct.place
	"dojo/_base/kernel" // kernel.deprecated
], function(array, declare, domConstruct, kernel){

	// module:
	//		dijit/_Container

	return declare("dijit._Container", null, {
		// summary:
		//		Mixin for widgets that contain HTML and/or a set of widget children.

		buildRendering: function(){
			this.inherited(arguments);
			if(!this.containerNode){
				// All widgets with descendants must set containerNode.
				// NB: this code doesn't quite work right because for TabContainer it runs before
				// _TemplatedMixin::buildRendering(), and thus
				// sets this.containerNode to this.domNode, later to be overridden by the assignment in the template.
				this.containerNode = this.domNode;
			}
		},

		addChild: function(/*dijit/_WidgetBase*/ widget, /*int?*/ insertIndex){
			// summary:
			//		Makes the given widget a child of this widget.
			// description:
			//		Inserts specified child widget's dom node as a child of this widget's
			//		container node, and possibly does other processing (such as layout).

			// I want to just call domConstruct.place(widget.domNode, this.containerNode, insertIndex), but the counting
			// is thrown off by text nodes and comment nodes that show up when constructed by markup.
			// In the future consider stripping those nodes on construction, either in the parser or this widget code.
			var refNode = this.containerNode;
			if(insertIndex > 0){
				// Old-school way to get nth child; dojo.query would be easier but _Container was weened from dojo.query
				// in #10087 to minimize download size.   Not sure if that's still and issue with new smaller dojo/query.
				refNode = refNode.firstChild;
				while(insertIndex > 0){
					if(refNode.nodeType == 1){ insertIndex--; }
					refNode = refNode.nextSibling;
				}
				if(refNode){
					insertIndex = "before";
				}else{
					// to support addChild(child, n-1) where there are n children (should add child at end)
					refNode = this.containerNode;
					insertIndex = "last";
				}
			}

			domConstruct.place(widget.domNode, refNode, insertIndex);

			// If I've been started but the child widget hasn't been started,
			// start it now.  Make sure to do this after widget has been
			// inserted into the DOM tree, so it can see that it's being controlled by me,
			// so it doesn't try to size itself.
			if(this._started && !widget._started){
				widget.startup();
			}
		},

		removeChild: function(/*Widget|int*/ widget){
			// summary:
			//		Removes the passed widget instance from this widget but does
			//		not destroy it.  You can also pass in an integer indicating
			//		the index within the container to remove (ie, removeChild(5) removes the sixth widget).

			if(typeof widget == "number"){
				widget = this.getChildren()[widget];
			}

			if(widget){
				var node = widget.domNode;
				if(node && node.parentNode){
					node.parentNode.removeChild(node); // detach but don't destroy
				}
			}
		},

		hasChildren: function(){
			// summary:
			//		Returns true if widget has child widgets, i.e. if this.containerNode contains widgets.
			return this.getChildren().length > 0;	// Boolean
		},

		_getSiblingOfChild: function(/*dijit/_WidgetBase*/ child, /*int*/ dir){
			// summary:
			//		Get the next or previous widget sibling of child
			// dir:
			//		if 1, get the next sibling
			//		if -1, get the previous sibling
			// tags:
			//		private
			kernel.deprecated(this.declaredClass+"::_getSiblingOfChild() is deprecated. Use _KeyNavMixin::_getNext() instead.", "", "2.0");
			var children = this.getChildren(),
				idx = array.indexOf(children, child);	// int
			return children[idx + dir];
		},

		getIndexOfChild: function(/*dijit/_WidgetBase*/ child){
			// summary:
			//		Gets the index of the child in this container or -1 if not found
			return array.indexOf(this.getChildren(), child);	// int
		}
	});
});

},
'dojox/mobile/TransitionEvent':function(){
define(["dojo/_base/declare", "dojo/on"], function(declare, on){

	return declare("dojox.mobile.TransitionEvent", null, {
		// summary:
		//		A class used to trigger view transitions.
		
		constructor: function(/*DomNode*/target, /*Object*/transitionOptions, /*Event?*/triggerEvent){
			// summary:
			//		Creates a transition event.
			// target:
			//		The DOM node that initiates the transition (for example a ListItem).
			// transitionOptions:
			//		Contains the transition options.
			// triggerEvent:
			//		The event that triggered the transition (for example a touch event on a ListItem).
			this.transitionOptions = transitionOptions;
			this.target = target;
			this.triggerEvent = triggerEvent||null;
		},

		dispatch: function(){
			// summary:
			//		Dispatches this transition event. Emits a "startTransition" event on the target.
			var opts = {bubbles:true, cancelable:true, detail: this.transitionOptions, triggerEvent: this.triggerEvent};	
			var evt = on.emit(this.target,"startTransition", opts);
		}
	});
});

},
'dojox/mobile/ProgressIndicator':function(){
define([
	"dojo/_base/config",
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/dom-geometry",
	"dojo/dom-style",
	"dojo/has",
	"dijit/_Contained",
	"dijit/_WidgetBase",
	"./_css3"
], function(config, declare, lang, domClass, domConstruct, domGeometry, domStyle, has, Contained, WidgetBase, css3){

	// module:
	//		dojox/mobile/ProgressIndicator

	var cls = declare("dojox.mobile.ProgressIndicator", [WidgetBase, Contained], {
		// summary:
		//		A progress indication widget.
		// description:
		//		ProgressIndicator is a round spinning graphical representation
		//		that indicates the current task is ongoing.

		// interval: Number
		//		The time interval in milliseconds for updating the spinning
		//		indicator.
		interval: 100,

		// size: [const] Number
		//		The size of the indicator in pixels.
		//		Note that changing the value of the property after the widget
		//		creation has no effect.
		size: 40,

		// removeOnStop: Boolean
		//		If true, this widget is removed from the parent node
		//		when stop() is called.
		removeOnStop: true,

		// startSpinning: Boolean
		//		If true, calls start() to run the indicator at startup.
		startSpinning: false,

		// center: Boolean
		//		If true, the indicator is displayed as center aligned.
		center: true,

		// colors: String[]
		//		An array of indicator colors. 12 colors have to be given.
		//		If colors are not specified, CSS styles
		//		(mblProg0Color - mblProg11Color) are used.
		colors: null,

		/* internal properties */
		
		// baseClass: String
		//		The name of the CSS class of this widget.	
		baseClass: "mblProgressIndicator",

		constructor: function(){
			// summary:
			//		Creates a new instance of the class.
			this.colors = [];
			this._bars = [];
		},

		buildRendering: function(){
			this.inherited(arguments);
			if(this.center){
				domClass.add(this.domNode, "mblProgressIndicatorCenter");
			}
			this.containerNode = domConstruct.create("div", {className:"mblProgContainer"}, this.domNode);
			this.spinnerNode = domConstruct.create("div", null, this.containerNode);
			for(var i = 0; i < 12; i++){
				var div = domConstruct.create("div", {className:"mblProg mblProg"+i}, this.spinnerNode);
				this._bars.push(div);
			}
			this.scale(this.size);
			if(this.startSpinning){
				this.start();
			}
		},

		scale: function(/*Number*/size){
			// summary:
			//		Changes the size of the indicator.
			// size:
			//		The size of the indicator in pixels.
			var scale = size / 40;
			domStyle.set(this.containerNode, css3.add({}, {
				transform: "scale(" + scale + ")",
				transformOrigin: "0 0"
			}));
			domGeometry.setMarginBox(this.domNode, {w:size, h:size});
			domGeometry.setMarginBox(this.containerNode, {w:size / scale, h:size / scale});
		},

		start: function(){
			// summary:
			//		Starts the spinning of the ProgressIndicator.
			if(this.imageNode){
				var img = this.imageNode;
				var l = Math.round((this.containerNode.offsetWidth - img.offsetWidth) / 2);
				var t = Math.round((this.containerNode.offsetHeight - img.offsetHeight) / 2);
				img.style.margin = t+"px "+l+"px";
				return;
			}
			var cntr = 0;
			var _this = this;
			var n = 12;
			this.timer = setInterval(function(){
				cntr--;
				cntr = cntr < 0 ? n - 1 : cntr;
				var c = _this.colors;
				for(var i = 0; i < n; i++){
					var idx = (cntr + i) % n;
					if(c[idx]){
						_this._bars[i].style.backgroundColor = c[idx];
					}else{
						domClass.replace(_this._bars[i],
										 "mblProg" + idx + "Color",
										 "mblProg" + (idx === n - 1 ? 0 : idx + 1) + "Color");
					}
				}
			}, this.interval);
		},

		stop: function(){
			// summary:
			//		Stops the spinning of the ProgressIndicator.
			if(this.timer){
				clearInterval(this.timer);
			}
			this.timer = null;
			if(this.removeOnStop && this.domNode && this.domNode.parentNode){
				this.domNode.parentNode.removeChild(this.domNode);
			}
		},

		setImage: function(/*String*/file){
			// summary:
			//		Sets an indicator icon image file (typically animated GIF).
			//		If null is specified, restores the default spinner.
			if(file){
				this.imageNode = domConstruct.create("img", {src:file}, this.containerNode);
				this.spinnerNode.style.display = "none";
			}else{
				if(this.imageNode){
					this.containerNode.removeChild(this.imageNode);
					this.imageNode = null;
				}
				this.spinnerNode.style.display = "";
			}
		},

		destroy: function(){
			this.inherited(arguments);
			if(this === cls._instance){
				cls._instance = null;
			}
		}
	});

	cls._instance = null;
	cls.getInstance = function(props){
		if(!cls._instance){
			cls._instance = new cls(props);
		}
		return cls._instance;
	};

	return cls;
});

},
'dojox/mobile/_css3':function(){
define([
	"dojo/_base/window",
	"dojo/_base/array",
	"dojo/has"
], function(win, arr, has){
	
	// caches for capitalized names and hypen names
	var cnames = [], hnames = [];
	
	// element style used for feature testing
	var style = win.doc.createElement("div").style;
	
	// We just test webkit prefix for now since our themes only have standard and webkit
	// (see dojox/mobile/themes/common/css3.less)
	// More prefixes can be added if/when we add them to css3.less.
	var prefixes = ["webkit"];
	
	// Does the browser support CSS3 animations?
	has.add("css3-animations", function(global, document, element){
		var style = element.style;
		return (style["animation"] !== undefined && style["transition"] !== undefined) ||
			arr.some(prefixes, function(p){
				return style[p+"Animation"] !== undefined && style[p+"Transition"] !== undefined;
			});
	});
	
	var css3 = {
		// summary:
		//		This module provide some cross-browser support for CSS3 properties.
	
		name: function(/*String*/p, /*Boolean?*/hyphen){
			// summary:
			//		Returns the name of a CSS3 property with the correct prefix depending on the browser.
			// p:
			//		The (non-prefixed) property name. The property name is assumed to be consistent with
			//		the hyphen argument, for example "transition-property" if hyphen is true, or "transitionProperty"
			//		if hyphen is false. If the browser supports the non-prefixed property, the property name will be
			//		returned unchanged.
			// hyphen:
			//		Optional, true if hyphen notation should be used (for example "transition-property" or "-webkit-transition-property"),
			//		false for camel-case notation (for example "transitionProperty" or "webkitTransitionProperty").
			
			var n = (hyphen?hnames:cnames)[p];
			if(!n){
				
				if(/End|Start/.test(p)){
					// event names: no good way to feature-detect, so we
					// assume they have the same prefix as the corresponding style property
					var idx = p.length - (p.match(/End/) ? 3 : 5);
					var s = p.substr(0, idx);
					var pp = this.name(s);
					if(pp == s){
						// no prefix, standard event names are all lowercase
						n = p.toLowerCase();
					}else{
						// prefix, e.g. webkitTransitionEnd (camel case)
						n = pp + p.substr(idx);
					}
				}else if(p == "keyframes"){
					// special case for keyframes, we also rely on consistency between 'animation' and 'keyframes'
					var pk = this.name("animation", hyphen);
					if(pk == "animation"){
						n = p;
					}else if(hyphen){
						n = pk.replace(/animation/, "keyframes");
					}else{
						n = pk.replace(/Animation/, "Keyframes");
					}
				}else{
					// convert name to camel-case for feature test
					var cn = hyphen ? p.replace(/-(.)/g, function(match, p1){
    					return p1.toUpperCase();
					}) : p;
					
					if(style[cn] !== undefined){
						// standard non-prefixed property is supported
						n = p;
					}else{
						// try prefixed versions
						cn = cn.charAt(0).toUpperCase() + cn.slice(1);
						arr.some(prefixes, function(prefix){
							if(style[prefix+cn] !== undefined){
								if(hyphen){
									n = "-" + prefix + "-" + p;
								}else{
									n = prefix + cn;
								}
							}
						});
					}
				}
				
				if(!n){
					// The property is not supported, just return it unchanged, it will be ignored.
					n = p;
				}

				(hyphen?hnames:cnames)[p] = n;
			}
			return n;
		},
		
		add: function(/*Object*/styles, /*Object*/css3Styles){
			// summary:
			//		Prefixes all property names in "css3Styles" and adds the prefixed properties in "styles".
			//		Used as a convenience when an object is passed to domStyle.set to set multiple styles.
			// example:
			//		domStyle.set(bar, css3.add({
			//			opacity: 0.6,
			//			position: "absolute",
			//			backgroundColor: "#606060"
			//		}, {
			//			borderRadius: "2px",
			//			transformOrigin: "0 0"
			//		}));
			// returns:
			//		The "styles" argument where the CSS3 styles have been added.
			
			for(var p in css3Styles){
				if(css3Styles.hasOwnProperty(p)){
					styles[css3.name(p)] = css3Styles[p];
				}
			}
			return styles;
		}
	}
	
	return css3;
});

},
'dojo/NodeList-manipulate':function(){
define(["./query", "./_base/lang", "./_base/array", "./dom-construct", "./NodeList-dom"], function(dquery, lang, array, construct){
	// module:
	//		dojo/NodeList-manipulate

	/*=====
	return function(){
		// summary:
		//		Adds chainable methods to dojo.query() / NodeList instances for manipulating HTML
		//		and DOM nodes and their properties.
	};
	=====*/

	var NodeList = dquery.NodeList;

	//TODO: add a way to parse for widgets in the injected markup?

	function getText(/*DOMNode*/node){
		// summary:
		//		recursion method for text() to use. Gets text value for a node.
		// description:
		//		Juse uses nodedValue so things like <br/> tags do not end up in
		//		the text as any sort of line return.
		var text = "", ch = node.childNodes;
		for(var i = 0, n; n = ch[i]; i++){
			//Skip comments.
			if(n.nodeType != 8){
				if(n.nodeType == 1){
					text += getText(n);
				}else{
					text += n.nodeValue;
				}
			}
		}
		return text;
	}

	function getWrapInsertion(/*DOMNode*/node){
		// summary:
		//		finds the innermost element to use for wrap insertion.

		//Make it easy, assume single nesting, no siblings.
		while(node.childNodes[0] && node.childNodes[0].nodeType == 1){
			node = node.childNodes[0];
		}
		return node; //DOMNode
	}

	function makeWrapNode(/*DOMNode||String*/html, /*DOMNode*/refNode){
		// summary:
		//		convert HTML into nodes if it is not already a node.
		if(typeof html == "string"){
			html = construct.toDom(html, (refNode && refNode.ownerDocument));
			if(html.nodeType == 11){
				//DocumentFragment cannot handle cloneNode, so choose first child.
				html = html.childNodes[0];
			}
		}else if(html.nodeType == 1 && html.parentNode){
			//This element is already in the DOM clone it, but not its children.
			html = html.cloneNode(false);
		}
		return html; /*DOMNode*/
	}

	lang.extend(NodeList, {
		_placeMultiple: function(/*String||Node||NodeList*/query, /*String*/position){
			// summary:
			//		private method for inserting queried nodes into all nodes in this NodeList
			//		at different positions. Differs from NodeList.place because it will clone
			//		the nodes in this NodeList if the query matches more than one element.
			var nl2 = typeof query == "string" || query.nodeType ? dquery(query) : query;
			var toAdd = [];
			for(var i = 0; i < nl2.length; i++){
				//Go backwards in DOM to make dom insertions easier via insertBefore
				var refNode = nl2[i];
				var length = this.length;
				for(var j = length - 1, item; item = this[j]; j--){
					if(i > 0){
						//Need to clone the item. This also means
						//it needs to be added to the current NodeList
						//so it can also be the target of other chaining operations.
						item = this._cloneNode(item);
						toAdd.unshift(item);
					}
					if(j == length - 1){
						construct.place(item, refNode, position);
					}else{
						refNode.parentNode.insertBefore(item, refNode);
					}
					refNode = item;
				}
			}

			if(toAdd.length){
				//Add the toAdd items to the current NodeList. Build up list of args
				//to pass to splice.
				toAdd.unshift(0);
				toAdd.unshift(this.length - 1);
				Array.prototype.splice.apply(this, toAdd);
			}

			return this; // dojo/NodeList
		},

		innerHTML: function(/*String|DOMNode|NodeList?*/ value){
			// summary:
			//		allows setting the innerHTML of each node in the NodeList,
			//		if there is a value passed in, otherwise, reads the innerHTML value of the first node.
			// description:
			//		This method is simpler than the dojo/NodeList.html() method provided by
			//		`dojo/NodeList-html`. This method just does proper innerHTML insertion of HTML fragments,
			//		and it allows for the innerHTML to be read for the first node in the node list.
			//		Since dojo/NodeList-html already took the "html" name, this method is called
			//		"innerHTML". However, if dojo/NodeList-html has not been loaded yet, this
			//		module will define an "html" method that can be used instead. Be careful if you
			//		are working in an environment where it is possible that dojo/NodeList-html could
			//		have been loaded, since its definition of "html" will take precedence.
			//		The nodes represented by the value argument will be cloned if more than one
			//		node is in this NodeList. The nodes in this NodeList are returned in the "set"
			//		usage of this method, not the HTML that was inserted.
			// returns:
			//		if no value is passed, the result is String, the innerHTML of the first node.
			//		If a value is passed, the return is this dojo/NodeList
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"></div>
			//	|	<div id="bar"></div>
			//		This code inserts `<p>Hello World</p>` into both divs:
			//	|	dojo.query("div").innerHTML("<p>Hello World</p>");
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"><p>Hello Mars</p></div>
			//	|	<div id="bar"><p>Hello World</p></div>
			//		This code returns `<p>Hello Mars</p>`:
			//	|	var message = dojo.query("div").innerHTML();
			if(arguments.length){
				return this.addContent(value, "only"); // dojo/NodeList
			}else{
				return this[0].innerHTML; //String
			}
		},

		/*=====
		html: function(value){
			// summary:
			//		see the information for "innerHTML". "html" is an alias for "innerHTML", but is
			//		only defined if dojo/NodeList-html has not been loaded.
			// description:
			//		An alias for the "innerHTML" method, but only defined if there is not an existing
			//		"html" method on dojo/NodeList. Be careful if you are working in an environment
			//		where it is possible that dojo/NodeList-html could have been loaded, since its
			//		definition of "html" will take precedence. If you are not sure if dojo/NodeList-html
			//		could be loaded, use the "innerHTML" method.
			// value: String|DOMNode|NodeList?
			//		The HTML fragment to use as innerHTML. If value is not passed, then the innerHTML
			//		of the first element in this NodeList is returned.
			// returns:
			//		if no value is passed, the result is String, the innerHTML of the first node.
			//		If a value is passed, the return is this dojo/NodeList
			return; // dojo/NodeList|String
		},
		=====*/

		text: function(/*String*/value){
			// summary:
			//		allows setting the text value of each node in the NodeList,
			//		if there is a value passed in, otherwise, returns the text value for all the
			//		nodes in the NodeList in one string.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"></div>
			//	|	<div id="bar"></div>
			//		This code inserts "Hello World" into both divs:
			//	|	dojo.query("div").text("Hello World");
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"><p>Hello Mars <span>today</span></p></div>
			//	|	<div id="bar"><p>Hello World</p></div>
			//		This code returns "Hello Mars today":
			//	|	var message = dojo.query("div").text();
			// returns:
			//		if no value is passed, the result is String, the text value of the first node.
			//		If a value is passed, the return is this dojo/NodeList
			if(arguments.length){
				for(var i = 0, node; node = this[i]; i++){
					if(node.nodeType == 1){
						construct.empty(node);
						node.appendChild(node.ownerDocument.createTextNode(value));
					}
				}
				return this; // dojo/NodeList
			}else{
				var result = "";
				for(i = 0; node = this[i]; i++){
					result += getText(node);
				}
				return result; //String
			}
		},

		val: function(/*String||Array*/value){
			// summary:
			//		If a value is passed, allows seting the value property of form elements in this
			//		NodeList, or properly selecting/checking the right value for radio/checkbox/select
			//		elements. If no value is passed, the value of the first node in this NodeList
			//		is returned.
			// returns:
			//		if no value is passed, the result is String or an Array, for the value of the
			//		first node.
			//		If a value is passed, the return is this dojo/NodeList
			// example:
			//		assume a DOM created by this markup:
			//	|	<input type="text" value="foo">
			//	|	<select multiple>
			//	|		<option value="red" selected>Red</option>
			//	|		<option value="blue">Blue</option>
			//	|		<option value="yellow" selected>Yellow</option>
			//	|	</select>
			//		This code gets and sets the values for the form fields above:
			//	|	dojo.query('[type="text"]').val(); //gets value foo
			//	|	dojo.query('[type="text"]').val("bar"); //sets the input's value to "bar"
			// 	|	dojo.query("select").val() //gets array value ["red", "yellow"]
			// 	|	dojo.query("select").val(["blue", "yellow"]) //Sets the blue and yellow options to selected.

			//Special work for input elements.
			if(arguments.length){
				var isArray = lang.isArray(value);
				for(var index = 0, node; node = this[index]; index++){
					var name = node.nodeName.toUpperCase();
					var type = node.type;
					var newValue = isArray ? value[index] : value;

					if(name == "SELECT"){
						var opts = node.options;
						for(var i = 0; i < opts.length; i++){
							var opt = opts[i];
							if(node.multiple){
								opt.selected = (array.indexOf(value, opt.value) != -1);
							}else{
								opt.selected = (opt.value == newValue);
							}
						}
					}else if(type == "checkbox" || type == "radio"){
						node.checked = (node.value == newValue);
					}else{
						node.value = newValue;
					}
				}
				return this; // dojo/NodeList
			}else{
				//node already declared above.
				node = this[0];
				if(!node || node.nodeType != 1){
					return undefined;
				}
				value = node.value || "";
				if(node.nodeName.toUpperCase() == "SELECT" && node.multiple){
					//A multivalued selectbox. Do the pain.
					value = [];
					//opts declared above in if block.
					opts = node.options;
					//i declared above in if block;
					for(i = 0; i < opts.length; i++){
						//opt declared above in if block
						opt = opts[i];
						if(opt.selected){
							value.push(opt.value);
						}
					}
					if(!value.length){
						value = null;
					}
				}
				return value; //String||Array
			}
		},

		append: function(/*String||DOMNode||NodeList*/content){
			// summary:
			//		appends the content to every node in the NodeList.
			// description:
			//		The content will be cloned if the length of NodeList
			//		is greater than 1. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the appended content.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"><p>Hello Mars</p></div>
			//	|	<div id="bar"><p>Hello World</p></div>
			//		Running this code:
			//	|	dojo.query("div").append("<span>append</span>");
			//		Results in this DOM structure:
			//	|	<div id="foo"><p>Hello Mars</p><span>append</span></div>
			//	|	<div id="bar"><p>Hello World</p><span>append</span></div>
			return this.addContent(content, "last"); // dojo/NodeList
		},

		appendTo: function(/*String*/query){
			// summary:
			//		appends nodes in this NodeList to the nodes matched by
			//		the query passed to appendTo.
			// description:
			//		The nodes in this NodeList will be cloned if the query
			//		matches more than one element. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the matched nodes from the query.
			// example:
			//		assume a DOM created by this markup:
			//	|	<span>append</span>
			//	|	<p>Hello Mars</p>
			//	|	<p>Hello World</p>
			//		Running this code:
			//	|	dojo.query("span").appendTo("p");
			//		Results in this DOM structure:
			//	|	<p>Hello Mars<span>append</span></p>
			//	|	<p>Hello World<span>append</span></p>
			return this._placeMultiple(query, "last"); // dojo/NodeList
		},

		prepend: function(/*String||DOMNode||NodeList*/content){
			// summary:
			//		prepends the content to every node in the NodeList.
			// description:
			//		The content will be cloned if the length of NodeList
			//		is greater than 1. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the appended content.
			//		assume a DOM created by this markup:
			//	|	<div id="foo"><p>Hello Mars</p></div>
			//	|	<div id="bar"><p>Hello World</p></div>
			//		Running this code:
			//	|	dojo.query("div").prepend("<span>prepend</span>");
			//		Results in this DOM structure:
			//	|	<div id="foo"><span>prepend</span><p>Hello Mars</p></div>
			//	|	<div id="bar"><span>prepend</span><p>Hello World</p></div>
			return this.addContent(content, "first"); // dojo/NodeList
		},

		prependTo: function(/*String*/query){
			// summary:
			//		prepends nodes in this NodeList to the nodes matched by
			//		the query passed to prependTo.
			// description:
			//		The nodes in this NodeList will be cloned if the query
			//		matches more than one element. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the matched nodes from the query.
			// example:
			//		assume a DOM created by this markup:
			//	|	<span>prepend</span>
			//	|	<p>Hello Mars</p>
			//	|	<p>Hello World</p>
			//		Running this code:
			//	|	dojo.query("span").prependTo("p");
			//		Results in this DOM structure:
			//	|	<p><span>prepend</span>Hello Mars</p>
			//	|	<p><span>prepend</span>Hello World</p>
			return this._placeMultiple(query, "first"); // dojo/NodeList
		},

		after: function(/*String||Element||NodeList*/content){
			// summary:
			//		Places the content after every node in the NodeList.
			// description:
			//		The content will be cloned if the length of NodeList
			//		is greater than 1. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the appended content.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"><p>Hello Mars</p></div>
			//	|	<div id="bar"><p>Hello World</p></div>
			//		Running this code:
			//	|	dojo.query("div").after("<span>after</span>");
			//		Results in this DOM structure:
			//	|	<div id="foo"><p>Hello Mars</p></div><span>after</span>
			//	|	<div id="bar"><p>Hello World</p></div><span>after</span>
			return this.addContent(content, "after"); // dojo/NodeList
		},

		insertAfter: function(/*String*/query){
			// summary:
			//		The nodes in this NodeList will be placed after the nodes
			//		matched by the query passed to insertAfter.
			// description:
			//		The nodes in this NodeList will be cloned if the query
			//		matches more than one element. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the matched nodes from the query.
			// example:
			//		assume a DOM created by this markup:
			//	|	<span>after</span>
			//	|	<p>Hello Mars</p>
			//	|	<p>Hello World</p>
			//		Running this code:
			//	|	dojo.query("span").insertAfter("p");
			//		Results in this DOM structure:
			//	|	<p>Hello Mars</p><span>after</span>
			//	|	<p>Hello World</p><span>after</span>
			return this._placeMultiple(query, "after"); // dojo/NodeList
		},

		before: function(/*String||DOMNode||NodeList*/content){
			// summary:
			//		Places the content before every node in the NodeList.
			// description:
			//		The content will be cloned if the length of NodeList
			//		is greater than 1. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the appended content.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div id="foo"><p>Hello Mars</p></div>
			//	|	<div id="bar"><p>Hello World</p></div>
			//		Running this code:
			//	|	dojo.query("div").before("<span>before</span>");
			//		Results in this DOM structure:
			//	|	<span>before</span><div id="foo"><p>Hello Mars</p></div>
			//	|	<span>before</span><div id="bar"><p>Hello World</p></div>
			return this.addContent(content, "before"); // dojo/NodeList
		},

		insertBefore: function(/*String*/query){
			// summary:
			//		The nodes in this NodeList will be placed after the nodes
			//		matched by the query passed to insertAfter.
			// description:
			//		The nodes in this NodeList will be cloned if the query
			//		matches more than one element. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		dojo/NodeList, the nodes currently in this NodeList will be returned,
			//		not the matched nodes from the query.
			// example:
			//		assume a DOM created by this markup:
			//	|	<span>before</span>
			//	|	<p>Hello Mars</p>
			//	|	<p>Hello World</p>
			//		Running this code:
			//	|	dojo.query("span").insertBefore("p");
			//		Results in this DOM structure:
			//	|	<span>before</span><p>Hello Mars</p>
			//	|	<span>before</span><p>Hello World</p>
			return this._placeMultiple(query, "before"); // dojo/NodeList
		},

		/*=====
		remove: function(simpleFilter){
			// summary:
			//		alias for dojo/NodeList's orphan method. Removes elements
			//		in this list that match the simple filter from their parents
			//		and returns them as a new NodeList.
			// simpleFilter: String
			//		single-expression CSS rule. For example, ".thinger" or
			//		"#someId[attrName='value']" but not "div > span". In short,
			//		anything which does not invoke a descent to evaluate but
			//		can instead be used to test a single node is acceptable.

			return; // dojo/NodeList
		},
		=====*/
		remove: NodeList.prototype.orphan,

		wrap: function(/*String||DOMNode*/html){
			// summary:
			//		Wrap each node in the NodeList with html passed to wrap.
			// description:
			//		html will be cloned if the NodeList has more than one
			//		element. Only DOM nodes are cloned, not any attached
			//		event handlers.
			// returns:
			//		the nodes in the current NodeList will be returned,
			//		not the nodes from html argument.
			// example:
			//		assume a DOM created by this markup:
			//	|	<b>one</b>
			//	|	<b>two</b>
			//		Running this code:
			//	|	dojo.query("b").wrap("<div><span></span></div>");
			//		Results in this DOM structure:
			//	|	<div><span><b>one</b></span></div>
			//	|	<div><span><b>two</b></span></div>
			if(this[0]){
				html = makeWrapNode(html, this[0]);

				//Now cycle through the elements and do the insertion.
				for(var i = 0, node; node = this[i]; i++){
					//Always clone because if html is used to hold one of
					//the "this" nodes, then on the clone of html it will contain
					//that "this" node, and that would be bad.
					var clone = this._cloneNode(html);
					if(node.parentNode){
						node.parentNode.replaceChild(clone, node);
					}
					//Find deepest element and insert old node in it.
					var insertion = getWrapInsertion(clone);
					insertion.appendChild(node);
				}
			}
			return this; // dojo/NodeList
		},

		wrapAll: function(/*String||DOMNode*/html){
			// summary:
			//		Insert html where the first node in this NodeList lives, then place all
			//		nodes in this NodeList as the child of the html.
			// returns:
			//		the nodes in the current NodeList will be returned,
			//		not the nodes from html argument.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div class="container">
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			//		Running this code:
			//	|	dojo.query(".red").wrapAll('<div class="allRed"></div>');
			//		Results in this DOM structure:
			//	|	<div class="container">
			// 	|		<div class="allRed">
			// 	|			<div class="red">Red One</div>
			// 	|			<div class="red">Red Two</div>
			// 	|		</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			if(this[0]){
				html = makeWrapNode(html, this[0]);

				//Place the wrap HTML in place of the first node.
				this[0].parentNode.replaceChild(html, this[0]);

				//Now cycle through the elements and move them inside
				//the wrap.
				var insertion = getWrapInsertion(html);
				for(var i = 0, node; node = this[i]; i++){
					insertion.appendChild(node);
				}
			}
			return this; // dojo/NodeList
		},

		wrapInner: function(/*String||DOMNode*/html){
			// summary:
			//		For each node in the NodeList, wrap all its children with the passed in html.
			// description:
			//		html will be cloned if the NodeList has more than one
			//		element. Only DOM nodes are cloned, not any attached
			//		event handlers.
			// returns:
			//		the nodes in the current NodeList will be returned,
			//		not the nodes from html argument.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div class="container">
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			//		Running this code:
			//	|	dojo.query(".red").wrapInner('<span class="special"></span>');
			//		Results in this DOM structure:
			//	|	<div class="container">
			// 	|		<div class="red"><span class="special">Red One</span></div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="red"><span class="special">Red Two</span></div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			if(this[0]){
				html = makeWrapNode(html, this[0]);
				for(var i = 0; i < this.length; i++){
					//Always clone because if html is used to hold one of
					//the "this" nodes, then on the clone of html it will contain
					//that "this" node, and that would be bad.
					var clone = this._cloneNode(html);

					//Need to convert the childNodes to an array since wrapAll modifies the
					//DOM and can change the live childNodes NodeList.
					this._wrap(lang._toArray(this[i].childNodes), null, this._NodeListCtor).wrapAll(clone);
				}
			}
			return this; // dojo/NodeList
		},

		replaceWith: function(/*String||DOMNode||NodeList*/content){
			// summary:
			//		Replaces each node in ths NodeList with the content passed to replaceWith.
			// description:
			//		The content will be cloned if the length of NodeList
			//		is greater than 1. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		The nodes currently in this NodeList will be returned, not the replacing content.
			//		Note that the returned nodes have been removed from the DOM.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div class="container">
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			//		Running this code:
			//	|	dojo.query(".red").replaceWith('<div class="green">Green</div>');
			//		Results in this DOM structure:
			//	|	<div class="container">
			// 	|		<div class="green">Green</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="green">Green</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			content = this._normalize(content, this[0]);
			for(var i = 0, node; node = this[i]; i++){
				this._place(content, node, "before", i > 0);
				node.parentNode.removeChild(node);
			}
			return this; // dojo/NodeList
		},

		replaceAll: function(/*String*/query){
			// summary:
			//		replaces nodes matched by the query passed to replaceAll with the nodes
			//		in this NodeList.
			// description:
			//		The nodes in this NodeList will be cloned if the query
			//		matches more than one element. Only the DOM nodes are cloned, not
			//		any attached event handlers.
			// returns:
			//		The nodes currently in this NodeList will be returned, not the matched nodes
			//		from the query. The nodes currently in this NodeLIst could have
			//		been cloned, so the returned NodeList will include the cloned nodes.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div class="container">
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			//		Running this code:
			//	|	dojo.query(".red").replaceAll(".blue");
			//		Results in this DOM structure:
			//	|	<div class="container">
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="spacer">___</div>
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="red">Red Two</div>
			//	|	</div>
			var nl = dquery(query);
			var content = this._normalize(this, this[0]);
			for(var i = 0, node; node = nl[i]; i++){
				this._place(content, node, "before", i > 0);
				node.parentNode.removeChild(node);
			}
			return this; // dojo/NodeList
		},

		clone: function(){
			// summary:
			//		Clones all the nodes in this NodeList and returns them as a new NodeList.
			// description:
			//		Only the DOM nodes are cloned, not any attached event handlers.
			// returns:
			//		a cloned set of the original nodes.
			// example:
			//		assume a DOM created by this markup:
			//	|	<div class="container">
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="blue">Blue Two</div>
			//	|	</div>
			//		Running this code:
			//	|	dojo.query(".red").clone().appendTo(".container");
			//		Results in this DOM structure:
			//	|	<div class="container">
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="blue">Blue One</div>
			// 	|		<div class="red">Red Two</div>
			// 	|		<div class="blue">Blue Two</div>
			// 	|		<div class="red">Red One</div>
			// 	|		<div class="red">Red Two</div>
			//	|	</div>

			//TODO: need option to clone events?
			var ary = [];
			for(var i = 0; i < this.length; i++){
				ary.push(this._cloneNode(this[i]));
			}
			return this._wrap(ary, this, this._NodeListCtor); // dojo/NodeList
		}
	});

	//set up html method if one does not exist
	if(!NodeList.prototype.html){
		NodeList.prototype.html = NodeList.prototype.innerHTML;
	}

	return NodeList;
});

},
'dojox/mobile/RoundRectList':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/_base/event",
	"dojo/_base/lang",
	"dojo/_base/window",
	"dojo/dom-construct",
	"dojo/dom-attr",
	"dijit/_Contained",
	"dijit/_Container",
	"dijit/_WidgetBase"
], function(array, declare, event, lang, win, domConstruct, domAttr, Contained, Container, WidgetBase){

	// module:
	//		dojox/mobile/RoundRectList

	return declare("dojox.mobile.RoundRectList", [WidgetBase, Container, Contained], {
		// summary:
		//		A rounded rectangle list.
		// description:
		//		RoundRectList is a rounded rectangle list, which can be used to
		//		display a group of items. Each item must be a dojox/mobile/ListItem.

		// transition: String
		//		The default animated transition effect for child items.
		transition: "slide",

		// iconBase: String
		//		The default icon path for child items.
		iconBase: "",

		// iconPos: String
		//		The default icon position for child items.
		iconPos: "",

		// select: String
		//		Selection mode of the list. The check mark is shown for the
		//		selected list item(s). The value can be "single", "multiple", or "".
		//		If "single", there can be only one selected item at a time.
		//		If "multiple", there can be multiple selected items at a time.
		//		If "", the check mark is not shown.
		select: "",

		// stateful: Boolean
		//		If true, the last selected item remains highlighted.
		stateful: false,

		// syncWithViews: [const] Boolean
		//		If true, this widget listens to view transition events to be
		//		synchronized with view's visibility.
		//		Note that changing the value of the property after the widget
		//		creation has no effect.
		syncWithViews: false,

		// editable: [const] Boolean
		//		If true, the list can be reordered.
		//		Note that changing the value of the property after the widget
		//		creation has no effect.
		editable: false,

		// tag: String
		//		A name of html tag to create as domNode.
		tag: "ul",

		/* internal properties */
		// editableMixinClass: String
		//		The name of the mixin class.
		editableMixinClass: "dojox/mobile/_EditableListMixin",
		
		// baseClass: String
		//		The name of the CSS class of this widget.
		baseClass: "mblRoundRectList",
		
		// filterBoxClass: String
		//		The name of the CSS class added to the DOM node inside which is placed the 
		//		dojox/mobile/SearchBox created when mixing dojox/mobile/FilteredListMixin.
		//		The default value is "mblFilteredRoundRectListSearchBox".  
		filterBoxClass: "mblFilteredRoundRectListSearchBox",

		buildRendering: function(){
			this.domNode = this.srcNodeRef || domConstruct.create(this.tag);
			if(this.select){
				domAttr.set(this.domNode, "role", "listbox");
				if(this.select === "multiple"){
					domAttr.set(this.domNode, "aria-multiselectable", "true");
				}
			}
			this.inherited(arguments);
		},

		postCreate: function(){
			if(this.editable){
				require([this.editableMixinClass], lang.hitch(this, function(module){
					declare.safeMixin(this, new module());
				}));
			}
			this.connect(this.domNode, "onselectstart", event.stop);

			if(this.syncWithViews){ // see also TabBar#postCreate
				var f = function(view, moveTo, dir, transition, context, method){
					var child = array.filter(this.getChildren(), function(w){
						return w.moveTo === "#" + view.id || w.moveTo === view.id; })[0];
					if(child){ child.set("selected", true); }
				};
				this.subscribe("/dojox/mobile/afterTransitionIn", f);
				this.subscribe("/dojox/mobile/startView", f);
			}
		},

		resize: function(){
			// summary:
			//		Calls resize() of each child widget.
			array.forEach(this.getChildren(), function(child){
				if(child.resize){ child.resize(); }
			});
		},

		onCheckStateChanged: function(/*Widget*//*===== listItem, =====*/ /*String*//*===== newState =====*/){
			// summary:
			//		Stub function to connect to from your application.
			// description:
			//		Called when the check state has been changed.
		},

		_setStatefulAttr: function(stateful){
			// tags:
			//		private
			this._set("stateful", stateful);
			this.selectOne = stateful;
			array.forEach(this.getChildren(), function(child){
				child.setArrow && child.setArrow();
			});
		},

		deselectItem: function(/*dojox/mobile/ListItem*/item){
			// summary:
			//		Deselects the given item.
			item.set("selected", false);
		},

		deselectAll: function(){
			// summary:
			//		Deselects all the items.
			array.forEach(this.getChildren(), function(child){
				child.set("selected", false);
			});
		},

		selectItem: function(/*ListItem*/item){
			// summary:
			//		Selects the given item.
			item.set("selected", true);
		}
	});
});

},
'dojox/mobile/Button':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/_WidgetBase",
	"dijit/form/_ButtonMixin",
	"dijit/form/_FormWidgetMixin",
	"dojo/has",
	"dojo/has!dojo-bidi?dojox/mobile/bidi/Button"
	],
	function(array, declare, domClass, domConstruct, WidgetBase, ButtonMixin, FormWidgetMixin, has, BidiButton){

	var Button = declare(has("dojo-bidi") ? "dojox.mobile.NonBidiButton" : "dojox.mobile.Button", [WidgetBase, FormWidgetMixin, ButtonMixin], {
		// summary:
		//		Non-templated BUTTON widget with a thin API wrapper for click 
		//		events and for setting the label.
		//
		//		Buttons can display a label, an icon, or both.
		//		A label should always be specified (through innerHTML) or the label
		//		attribute.  It can be hidden via showLabel=false.
		// example:
		//	|	<button data-dojo-type="dojox/mobile/Button" onClick="...">Hello world</button>

		// baseClass: String
		//		The name of the CSS class of this widget.
		baseClass: "mblButton",

		// _setTypeAttr: [private] Function 
		//		Overrides the automatic assignment of type to nodes, because it causes
		//		exception on IE. Instead, the type must be specified as this.type
		//		when the node is created, as part of the original DOM.
		_setTypeAttr: null,

		// duration: Number
		//		The duration of selection, in milliseconds, or -1 for no post-click CSS styling.
		duration: 1000,

		/*=====
		// label: String
		//		The label of the button.
		label: "",
		=====*/
		
		_onClick: function(e){
			// tags:
			//		private
			var ret = this.inherited(arguments);
			if(ret && this.duration >= 0){ // if its not a button with a state, then emulate press styles
				var button = this.focusNode || this.domNode;
				var newStateClasses = (this.baseClass+' '+this["class"]).split(" ");
				newStateClasses = array.map(newStateClasses, function(c){ return c+"Selected"; });
				domClass.add(button, newStateClasses);
				this.defer(function(){
					domClass.remove(button, newStateClasses);
				}, this.duration);
			}
			return ret;
		},

		isFocusable: function(){ 
			// Override of the method of dijit/_WidgetBase.
			return false; 
		},

		buildRendering: function(){
			if(!this.srcNodeRef){
				this.srcNodeRef = domConstruct.create("button", {"type": this.type});
			}else if(this._cv){
				var n = this.srcNodeRef.firstChild;
				if(n && n.nodeType === 3){
					n.nodeValue = this._cv(n.nodeValue);
				}
			}
			this.inherited(arguments);
			this.focusNode = this.domNode;
		},

		postCreate: function(){
			this.inherited(arguments);
			this.connect(this.domNode, "onclick", "_onClick");
		},

		_setLabelAttr: function(/*String*/ content){
			// tags:
			//		private
			this.inherited(arguments, [this._cv ? this._cv(content) : content]);
		}
	});

	return has("dojo-bidi") ? declare("dojox.mobile.Button", [Button, BidiButton]) : Button;
});

},
'dijit/form/_ButtonMixin':function(){
define([
	"dojo/_base/declare", // declare
	"dojo/dom", // dom.setSelectable
	"dojo/has",
	"../registry"        // registry.byNode
], function(declare, dom, has, registry){

	// module:
	//		dijit/form/_ButtonMixin

	var ButtonMixin = declare("dijit.form._ButtonMixin" + (has("dojo-bidi") ? "_NoBidi" : ""), null, {
		// summary:
		//		A mixin to add a thin standard API wrapper to a normal HTML button
		// description:
		//		A label should always be specified (through innerHTML) or the label attribute.
		//
		//		Attach points:
		//
		//		- focusNode (required): this node receives focus
		//		- valueNode (optional): this node's value gets submitted with FORM elements
		//		- containerNode (optional): this node gets the innerHTML assignment for label
		// example:
		// |	<button data-dojo-type="dijit/form/Button" onClick="...">Hello world</button>
		// example:
		// |	var button1 = new Button({label: "hello world", onClick: foo});
		// |	dojo.body().appendChild(button1.domNode);

		// label: HTML String
		//		Content to display in button.
		label: "",

		// type: [const] String
		//		Type of button (submit, reset, button, checkbox, radio)
		type: "button",

		__onClick: function(/*Event*/ e){
			// summary:
			//		Internal function to divert the real click onto the hidden INPUT that has a native default action associated with it
			// type:
			//		private
			e.stopPropagation();
			e.preventDefault();
			if(!this.disabled){
				// cannot use on.emit since button default actions won't occur
				this.valueNode.click(e);
			}
			return false;
		},

		_onClick: function(/*Event*/ e){
			// summary:
			//		Internal function to handle click actions
			if(this.disabled){
				e.stopPropagation();
				e.preventDefault();
				return false;
			}
			if(this.onClick(e) === false){
				e.preventDefault();
			}
			cancelled = e.defaultPrevented;

			// Signal Form/Dialog to submit/close.  For 2.0, consider removing this code and instead making the Form/Dialog
			// listen for bubbled click events where evt.target.type == "submit" && !evt.defaultPrevented.
			if(!cancelled && this.type == "submit" && !(this.valueNode || this.focusNode).form){
				for(var node = this.domNode; node.parentNode; node = node.parentNode){
					var widget = registry.byNode(node);
					if(widget && typeof widget._onSubmit == "function"){
						widget._onSubmit(e);
						e.preventDefault(); // action has already occurred
						cancelled = true;
						break;
					}
				}
			}

			return !cancelled;
		},

		postCreate: function(){
			this.inherited(arguments);
			dom.setSelectable(this.focusNode, false);
		},

		onClick: function(/*Event*/ /*===== e =====*/){
			// summary:
			//		Callback for when button is clicked.
			//		If type="submit", return true to perform submit, or false to cancel it.
			// type:
			//		callback
			return true;		// Boolean
		},

		_setLabelAttr: function(/*String*/ content){
			// summary:
			//		Hook for set('label', ...) to work.
			// description:
			//		Set the label (text) of the button; takes an HTML string.
			this._set("label", content);
			var labelNode = this.containerNode || this.focusNode;
			labelNode.innerHTML = content;
		}
	});

	if(has("dojo-bidi")){
		ButtonMixin = declare("dijit.form._ButtonMixin", ButtonMixin, {
			_setLabelAttr: function(){
				this.inherited(arguments);
				var labelNode = this.containerNode || this.focusNode;
				this.applyTextDir(labelNode);
			}
		});
	}

	return ButtonMixin;
});

},
'dijit/form/_FormWidgetMixin':function(){
define([
	"dojo/_base/array", // array.forEach
	"dojo/_base/declare", // declare
	"dojo/dom-attr", // domAttr.set
	"dojo/dom-style", // domStyle.get
	"dojo/_base/lang", // lang.hitch lang.isArray
	"dojo/mouse", // mouse.isLeft
	"dojo/on",
	"dojo/sniff", // has("webkit")
	"dojo/window", // winUtils.scrollIntoView
	"../a11y"    // a11y.hasDefaultTabStop
], function(array, declare, domAttr, domStyle, lang, mouse, on, has, winUtils, a11y){

	// module:
	//		dijit/form/_FormWidgetMixin

	return declare("dijit.form._FormWidgetMixin", null, {
		// summary:
		//		Mixin for widgets corresponding to native HTML elements such as `<checkbox>` or `<button>`,
		//		which can be children of a `<form>` node or a `dijit/form/Form` widget.
		//
		// description:
		//		Represents a single HTML element.
		//		All these widgets should have these attributes just like native HTML input elements.
		//		You can set them during widget construction or afterwards, via `dijit/_WidgetBase.set()`.
		//
		//		They also share some common methods.

		// name: [const] String
		//		Name used when submitting form; same as "name" attribute or plain HTML elements
		name: "",

		// alt: String
		//		Corresponds to the native HTML `<input>` element's attribute.
		alt: "",

		// value: String
		//		Corresponds to the native HTML `<input>` element's attribute.
		value: "",

		// type: [const] String
		//		Corresponds to the native HTML `<input>` element's attribute.
		type: "text",

		// type: String
		//		Apply aria-label in markup to the widget's focusNode
		"aria-label": "focusNode",

		// tabIndex: String
		//		Order fields are traversed when user hits the tab key
		tabIndex: "0",
		_setTabIndexAttr: "focusNode", // force copy even when tabIndex default value, needed since Button is <span>

		// disabled: Boolean
		//		Should this widget respond to user input?
		//		In markup, this is specified as "disabled='disabled'", or just "disabled".
		disabled: false,

		// intermediateChanges: Boolean
		//		Fires onChange for each value change or only on demand
		intermediateChanges: false,

		// scrollOnFocus: Boolean
		//		On focus, should this widget scroll into view?
		scrollOnFocus: true,

		// Override _WidgetBase mapping id to this.domNode, needs to be on focusNode so <label> etc.
		// works with screen reader
		_setIdAttr: "focusNode",

		_setDisabledAttr: function(/*Boolean*/ value){
			this._set("disabled", value);
			domAttr.set(this.focusNode, 'disabled', value);
			if(this.valueNode){
				domAttr.set(this.valueNode, 'disabled', value);
			}
			this.focusNode.setAttribute("aria-disabled", value ? "true" : "false");

			if(value){
				// reset these, because after the domNode is disabled, we can no longer receive
				// mouse related events, see #4200
				this._set("hovering", false);
				this._set("active", false);

				// clear tab stop(s) on this widget's focusable node(s)  (ComboBox has two focusable nodes)
				var attachPointNames = "tabIndex" in this.attributeMap ? this.attributeMap.tabIndex :
					("_setTabIndexAttr" in this) ? this._setTabIndexAttr : "focusNode";
				array.forEach(lang.isArray(attachPointNames) ? attachPointNames : [attachPointNames], function(attachPointName){
					var node = this[attachPointName];
					// complex code because tabIndex=-1 on a <div> doesn't work on FF
					if(has("webkit") || a11y.hasDefaultTabStop(node)){    // see #11064 about webkit bug
						node.setAttribute('tabIndex', "-1");
					}else{
						node.removeAttribute('tabIndex');
					}
				}, this);
			}else{
				if(this.tabIndex != ""){
					this.set('tabIndex', this.tabIndex);
				}
			}
		},

		_onFocus: function(/*String*/ by){
			// If user clicks on the widget, even if the mouse is released outside of it,
			// this widget's focusNode should get focus (to mimic native browser behavior).
			// Browsers often need help to make sure the focus via mouse actually gets to the focusNode.
			// TODO: consider removing all of this for 2.0 or sooner, see #16622 etc.
			if(by == "mouse" && this.isFocusable()){
				// IE exhibits strange scrolling behavior when refocusing a node so only do it when !focused.
				var focusHandle = this.own(on(this.focusNode, "focus", function(){
					mouseUpHandle.remove();
					focusHandle.remove();
				}))[0];
				// Set a global event to handle mouseup, so it fires properly
				// even if the cursor leaves this.domNode before the mouse up event.
				var mouseUpHandle = this.own(on(this.ownerDocumentBody, "mouseup, touchend", lang.hitch(this, function(evt){
					mouseUpHandle.remove();
					focusHandle.remove();
					// if here, then the mousedown did not focus the focusNode as the default action
					if(this.focused){
						if(evt.type == "touchend"){
							this.defer("focus"); // native focus hasn't occurred yet
						}else{
							this.focus(); // native focus already occurred on mousedown
						}
					}
				})))[0];
			}
			if(this.scrollOnFocus){
				this.defer(function(){
					winUtils.scrollIntoView(this.domNode);
				}); // without defer, the input caret position can change on mouse click
			}
			this.inherited(arguments);
		},

		isFocusable: function(){
			// summary:
			//		Tells if this widget is focusable or not.  Used internally by dijit.
			// tags:
			//		protected
			return !this.disabled && this.focusNode && (domStyle.get(this.domNode, "display") != "none");
		},

		focus: function(){
			// summary:
			//		Put focus on this widget
			if(!this.disabled && this.focusNode.focus){
				try{
					this.focusNode.focus();
				}catch(e){
				}
				/*squelch errors from hidden nodes*/
			}
		},

		compare: function(/*anything*/ val1, /*anything*/ val2){
			// summary:
			//		Compare 2 values (as returned by get('value') for this widget).
			// tags:
			//		protected
			if(typeof val1 == "number" && typeof val2 == "number"){
				return (isNaN(val1) && isNaN(val2)) ? 0 : val1 - val2;
			}else if(val1 > val2){
				return 1;
			}else if(val1 < val2){
				return -1;
			}else{
				return 0;
			}
		},

		onChange: function(/*===== newValue =====*/){
			// summary:
			//		Callback when this widget's value is changed.
			// tags:
			//		callback
		},

		// _onChangeActive: [private] Boolean
		//		Indicates that changes to the value should call onChange() callback.
		//		This is false during widget initialization, to avoid calling onChange()
		//		when the initial value is set.
		_onChangeActive: false,

		_handleOnChange: function(/*anything*/ newValue, /*Boolean?*/ priorityChange){
			// summary:
			//		Called when the value of the widget is set.  Calls onChange() if appropriate
			// newValue:
			//		the new value
			// priorityChange:
			//		For a slider, for example, dragging the slider is priorityChange==false,
			//		but on mouse up, it's priorityChange==true.  If intermediateChanges==false,
			//		onChange is only called form priorityChange=true events.
			// tags:
			//		private
			if(this._lastValueReported == undefined && (priorityChange === null || !this._onChangeActive)){
				// this block executes not for a change, but during initialization,
				// and is used to store away the original value (or for ToggleButton, the original checked state)
				this._resetValue = this._lastValueReported = newValue;
			}
			this._pendingOnChange = this._pendingOnChange
				|| (typeof newValue != typeof this._lastValueReported)
				|| (this.compare(newValue, this._lastValueReported) != 0);
			if((this.intermediateChanges || priorityChange || priorityChange === undefined) && this._pendingOnChange){
				this._lastValueReported = newValue;
				this._pendingOnChange = false;
				if(this._onChangeActive){
					if(this._onChangeHandle){
						this._onChangeHandle.remove();
					}
					// defer allows hidden value processing to run and
					// also the onChange handler can safely adjust focus, etc
					this._onChangeHandle = this.defer(
						function(){
							this._onChangeHandle = null;
							this.onChange(newValue);
						}); // try to collapse multiple onChange's fired faster than can be processed
				}
			}
		},

		create: function(){
			// Overrides _Widget.create()
			this.inherited(arguments);
			this._onChangeActive = true;
		},

		destroy: function(){
			if(this._onChangeHandle){ // destroy called before last onChange has fired
				this._onChangeHandle.remove();
				this.onChange(this._lastValueReported);
			}
			this.inherited(arguments);
		}
	});
});

},
'dojo/window':function(){
define(["./_base/lang", "./sniff", "./_base/window", "./dom", "./dom-geometry", "./dom-style", "./dom-construct"],
	function(lang, has, baseWindow, dom, geom, style, domConstruct){

	// feature detection
	/* not needed but included here for future reference
	has.add("rtl-innerVerticalScrollBar-on-left", function(win, doc){
		var	body = baseWindow.body(doc),
			scrollable = domConstruct.create('div', {
				style: {overflow:'scroll', overflowX:'hidden', direction:'rtl', visibility:'hidden', position:'absolute', left:'0', width:'64px', height:'64px'}
			}, body, "last"),
			center = domConstruct.create('center', {
				style: {overflow:'hidden', direction:'ltr'}
			}, scrollable, "last"),
			inner = domConstruct.create('div', {
				style: {overflow:'visible', display:'inline' }
			}, center, "last");
		inner.innerHTML="&nbsp;";
		var midPoint = Math.max(inner.offsetLeft, geom.position(inner).x);
		var ret = midPoint >= 32;
		center.removeChild(inner);
		scrollable.removeChild(center);
		body.removeChild(scrollable);
		return ret;
	});
	*/
	has.add("rtl-adjust-position-for-verticalScrollBar", function(win, doc){
		var	body = baseWindow.body(doc),
			scrollable = domConstruct.create('div', {
				style: {overflow:'scroll', overflowX:'visible', direction:'rtl', visibility:'hidden', position:'absolute', left:'0', top:'0', width:'64px', height:'64px'}
			}, body, "last"),
			div = domConstruct.create('div', {
				style: {overflow:'hidden', direction:'ltr'}
			}, scrollable, "last"),
			ret = geom.position(div).x != 0;
		scrollable.removeChild(div);
		body.removeChild(scrollable);
		return ret;
	});

	has.add("position-fixed-support", function(win, doc){
		// IE6, IE7+quirks, and some older mobile browsers don't support position:fixed
		var	body = baseWindow.body(doc),
			outer = domConstruct.create('span', {
				style: {visibility:'hidden', position:'fixed', left:'1px', top:'1px'}
			}, body, "last"),
			inner = domConstruct.create('span', {
				style: {position:'fixed', left:'0', top:'0'}
			}, outer, "last"),
			ret = geom.position(inner).x != geom.position(outer).x;
		outer.removeChild(inner);
		body.removeChild(outer);
		return ret;
	});

	// module:
	//		dojo/window

	var window = {
		// summary:
		//		TODOC

		getBox: function(/*Document?*/ doc){
			// summary:
			//		Returns the dimensions and scroll position of the viewable area of a browser window

			doc = doc || baseWindow.doc;

			var
				scrollRoot = (doc.compatMode == 'BackCompat') ? baseWindow.body(doc) : doc.documentElement,
				// get scroll position
				scroll = geom.docScroll(doc), // scrollRoot.scrollTop/Left should work
				w, h;

			if(has("touch")){ // if(scrollbars not supported)
				var uiWindow = window.get(doc);   // use UI window, not dojo.global window
				// on mobile, scrollRoot.clientHeight <= uiWindow.innerHeight <= scrollRoot.offsetHeight, return uiWindow.innerHeight
				w = uiWindow.innerWidth || scrollRoot.clientWidth; // || scrollRoot.clientXXX probably never evaluated
				h = uiWindow.innerHeight || scrollRoot.clientHeight;
			}else{
				// on desktops, scrollRoot.clientHeight <= scrollRoot.offsetHeight <= uiWindow.innerHeight, return scrollRoot.clientHeight
				// uiWindow.innerWidth/Height includes the scrollbar and cannot be used
				w = scrollRoot.clientWidth;
				h = scrollRoot.clientHeight;
			}
			return {
				l: scroll.x,
				t: scroll.y,
				w: w,
				h: h
			};
		},

		get: function(/*Document*/ doc){
			// summary:
			//		Get window object associated with document doc.
			// doc:
			//		The document to get the associated window for.

			// In some IE versions (at least 6.0), document.parentWindow does not return a
			// reference to the real window object (maybe a copy), so we must fix it as well
			// We use IE specific execScript to attach the real window reference to
			// document._parentWindow for later use
			if(has("ie") && window !== document.parentWindow){
				/*
				In IE 6, only the variable "window" can be used to connect events (others
				may be only copies).
				*/
				doc.parentWindow.execScript("document._parentWindow = window;", "Javascript");
				//to prevent memory leak, unset it after use
				//another possibility is to add an onUnload handler which seems overkill to me (liucougar)
				var win = doc._parentWindow;
				doc._parentWindow = null;
				return win;	//	Window
			}

			return doc.parentWindow || doc.defaultView;	//	Window
		},

		scrollIntoView: function(/*DomNode*/ node, /*Object?*/ pos){
			// summary:
			//		Scroll the passed node into view using minimal movement, if it is not already.

			// Don't rely on node.scrollIntoView working just because the function is there since
			// it forces the node to the page's bottom or top (and left or right in IE) without consideration for the minimal movement.
			// WebKit's node.scrollIntoViewIfNeeded doesn't work either for inner scrollbars in right-to-left mode
			// and when there's a fixed position scrollable element

			try{ // catch unexpected/unrecreatable errors (#7808) since we can recover using a semi-acceptable native method
				node = dom.byId(node);
				var	doc = node.ownerDocument || baseWindow.doc,	// TODO: why baseWindow.doc?  Isn't node.ownerDocument always defined?
					body = baseWindow.body(doc),
					html = doc.documentElement || body.parentNode,
					isIE = has("ie"),
					isWK = has("webkit");
				// if an untested browser, then use the native method
				if(node == body || node == html){ return; }
				if(!(has("mozilla") || isIE || isWK || has("opera")) && ("scrollIntoView" in node)){
					node.scrollIntoView(false); // short-circuit to native if possible
					return;
				}
				var	backCompat = doc.compatMode == 'BackCompat',
					rootWidth = Math.min(body.clientWidth || html.clientWidth, html.clientWidth || body.clientWidth),
					rootHeight = Math.min(body.clientHeight || html.clientHeight, html.clientHeight || body.clientHeight),
					scrollRoot = (isWK || backCompat) ? body : html,
					nodePos = pos || geom.position(node),
					el = node.parentNode,
					isFixed = function(el){
						return (isIE <= 6 || (isIE == 7 && backCompat))
							? false
							: (has("position-fixed-support") && (style.get(el, 'position').toLowerCase() == "fixed"));
					};
				if(isFixed(node)){ return; } // nothing to do
				while(el){
					if(el == body){ el = scrollRoot; }
					var	elPos = geom.position(el),
						fixedPos = isFixed(el),
						rtl = style.getComputedStyle(el).direction.toLowerCase() == "rtl";

					if(el == scrollRoot){
						elPos.w = rootWidth; elPos.h = rootHeight;
						if(scrollRoot == html && isIE && rtl){ elPos.x += scrollRoot.offsetWidth-elPos.w; } // IE workaround where scrollbar causes negative x
						if(elPos.x < 0 || !isIE || isIE >= 9){ elPos.x = 0; } // older IE can have values > 0
						if(elPos.y < 0 || !isIE || isIE >= 9){ elPos.y = 0; }
					}else{
						var pb = geom.getPadBorderExtents(el);
						elPos.w -= pb.w; elPos.h -= pb.h; elPos.x += pb.l; elPos.y += pb.t;
						var clientSize = el.clientWidth,
							scrollBarSize = elPos.w - clientSize;
						if(clientSize > 0 && scrollBarSize > 0){
							if(rtl && has("rtl-adjust-position-for-verticalScrollBar")){
								elPos.x += scrollBarSize;
							}
							elPos.w = clientSize;
						}
						clientSize = el.clientHeight;
						scrollBarSize = elPos.h - clientSize;
						if(clientSize > 0 && scrollBarSize > 0){
							elPos.h = clientSize;
						}
					}
					if(fixedPos){ // bounded by viewport, not parents
						if(elPos.y < 0){
							elPos.h += elPos.y; elPos.y = 0;
						}
						if(elPos.x < 0){
							elPos.w += elPos.x; elPos.x = 0;
						}
						if(elPos.y + elPos.h > rootHeight){
							elPos.h = rootHeight - elPos.y;
						}
						if(elPos.x + elPos.w > rootWidth){
							elPos.w = rootWidth - elPos.x;
						}
					}
					// calculate overflow in all 4 directions
					var	l = nodePos.x - elPos.x, // beyond left: < 0
//						t = nodePos.y - Math.max(elPos.y, 0), // beyond top: < 0
						t = nodePos.y - elPos.y, // beyond top: < 0
						r = l + nodePos.w - elPos.w, // beyond right: > 0
						bot = t + nodePos.h - elPos.h; // beyond bottom: > 0
					var s, old;
					if(r * l > 0 && (!!el.scrollLeft || el == scrollRoot || el.scrollWidth > el.offsetHeight)){
						s = Math[l < 0? "max" : "min"](l, r);
						if(rtl && ((isIE == 8 && !backCompat) || isIE >= 9)){ s = -s; }
						old = el.scrollLeft;
						el.scrollLeft += s;
						s = el.scrollLeft - old;
						nodePos.x -= s;
					}
					if(bot * t > 0 && (!!el.scrollTop || el == scrollRoot || el.scrollHeight > el.offsetHeight)){
						s = Math.ceil(Math[t < 0? "max" : "min"](t, bot));
						old = el.scrollTop;
						el.scrollTop += s;
						s = el.scrollTop - old;
						nodePos.y -= s;
					}
					el = (el != scrollRoot) && !fixedPos && el.parentNode;
				}
			}catch(error){
				console.error('scrollIntoView: ' + error);
				node.scrollIntoView(false);
			}
		}
	};

	 1  && lang.setObject("dojo.window", window);

	return window;
});

},
'dijit/a11y':function(){
define([
	"dojo/_base/array", // array.forEach array.map
	"dojo/dom",			// dom.byId
	"dojo/dom-attr", // domAttr.attr domAttr.has
	"dojo/dom-style", // domStyle.style
	"dojo/_base/lang", // lang.mixin()
	"dojo/sniff", // has("ie")  1 
	"./main"	// for exporting methods to dijit namespace
], function(array, dom, domAttr, domStyle, lang, has, dijit){

	// module:
	//		dijit/a11y

	var a11y = {
		// summary:
		//		Accessibility utility functions (keyboard, tab stops, etc.)

		_isElementShown: function(/*Element*/ elem){
			var s = domStyle.get(elem);
			return (s.visibility != "hidden")
				&& (s.visibility != "collapsed")
				&& (s.display != "none")
				&& (domAttr.get(elem, "type") != "hidden");
		},

		hasDefaultTabStop: function(/*Element*/ elem){
			// summary:
			//		Tests if element is tab-navigable even without an explicit tabIndex setting

			// No explicit tabIndex setting, need to investigate node type
			switch(elem.nodeName.toLowerCase()){
				case "a":
					// An <a> w/out a tabindex is only navigable if it has an href
					return domAttr.has(elem, "href");
				case "area":
				case "button":
				case "input":
				case "object":
				case "select":
				case "textarea":
					// These are navigable by default
					return true;
				case "iframe":
					// If it's an editor <iframe> then it's tab navigable.
					var body;
					try{
						// non-IE
						var contentDocument = elem.contentDocument;
						if("designMode" in contentDocument && contentDocument.designMode == "on"){
							return true;
						}
						body = contentDocument.body;
					}catch(e1){
						// contentWindow.document isn't accessible within IE7/8
						// if the iframe.src points to a foreign url and this
						// page contains an element, that could get focus
						try{
							body = elem.contentWindow.document.body;
						}catch(e2){
							return false;
						}
					}
					return body && (body.contentEditable == 'true' ||
						(body.firstChild && body.firstChild.contentEditable == 'true'));
				default:
					return elem.contentEditable == 'true';
			}
		},

		isTabNavigable: function(/*Element*/ elem){
			// summary:
			//		Tests if an element is tab-navigable

			// TODO: convert (and rename method) to return effective tabIndex; will save time in _getTabNavigable()
			if(domAttr.get(elem, "disabled")){
				return false;
			}else if(domAttr.has(elem, "tabIndex")){
				// Explicit tab index setting
				return domAttr.get(elem, "tabIndex") >= 0; // boolean
			}else{
				// No explicit tabIndex setting, so depends on node type
				return a11y.hasDefaultTabStop(elem);
			}
		},

		_getTabNavigable: function(/*DOMNode*/ root){
			// summary:
			//		Finds descendants of the specified root node.
			// description:
			//		Finds the following descendants of the specified root node:
			//
			//		- the first tab-navigable element in document order
			//		  without a tabIndex or with tabIndex="0"
			//		- the last tab-navigable element in document order
			//		  without a tabIndex or with tabIndex="0"
			//		- the first element in document order with the lowest
			//		  positive tabIndex value
			//		- the last element in document order with the highest
			//		  positive tabIndex value
			var first, last, lowest, lowestTabindex, highest, highestTabindex, radioSelected = {};

			function radioName(node){
				// If this element is part of a radio button group, return the name for that group.
				return node && node.tagName.toLowerCase() == "input" &&
					node.type && node.type.toLowerCase() == "radio" &&
					node.name && node.name.toLowerCase();
			}

			var shown = a11y._isElementShown, isTabNavigable = a11y.isTabNavigable;
			var walkTree = function(/*DOMNode*/ parent){
				for(var child = parent.firstChild; child; child = child.nextSibling){
					// Skip text elements, hidden elements, and also non-HTML elements (those in custom namespaces) in IE,
					// since show() invokes getAttribute("type"), which crash on VML nodes in IE.
					if(child.nodeType != 1 || (has("ie") <= 9 && child.scopeName !== "HTML") || !shown(child)){
						continue;
					}

					if(isTabNavigable(child)){
						var tabindex = +domAttr.get(child, "tabIndex");	// + to convert string --> number
						if(!domAttr.has(child, "tabIndex") || tabindex == 0){
							if(!first){
								first = child;
							}
							last = child;
						}else if(tabindex > 0){
							if(!lowest || tabindex < lowestTabindex){
								lowestTabindex = tabindex;
								lowest = child;
							}
							if(!highest || tabindex >= highestTabindex){
								highestTabindex = tabindex;
								highest = child;
							}
						}
						var rn = radioName(child);
						if(domAttr.get(child, "checked") && rn){
							radioSelected[rn] = child;
						}
					}
					if(child.nodeName.toUpperCase() != 'SELECT'){
						walkTree(child);
					}
				}
			};
			if(shown(root)){
				walkTree(root);
			}
			function rs(node){
				// substitute checked radio button for unchecked one, if there is a checked one with the same name.
				return radioSelected[radioName(node)] || node;
			}

			return { first: rs(first), last: rs(last), lowest: rs(lowest), highest: rs(highest) };
		},

		getFirstInTabbingOrder: function(/*String|DOMNode*/ root, /*Document?*/ doc){
			// summary:
			//		Finds the descendant of the specified root node
			//		that is first in the tabbing order
			var elems = a11y._getTabNavigable(dom.byId(root, doc));
			return elems.lowest ? elems.lowest : elems.first; // DomNode
		},

		getLastInTabbingOrder: function(/*String|DOMNode*/ root, /*Document?*/ doc){
			// summary:
			//		Finds the descendant of the specified root node
			//		that is last in the tabbing order
			var elems = a11y._getTabNavigable(dom.byId(root, doc));
			return elems.last ? elems.last : elems.highest; // DomNode
		}
	};

	 1  && lang.mixin(dijit, a11y);

	return a11y;
});

},
'dojox/mobile/RoundRectStoreList':function(){
define([
	"dojo/_base/declare",
	"./RoundRectList",
	"./_StoreListMixin"
], function(declare, RoundRectList, StoreListMixin){

	// module:
	//		dojox/mobile/RoundRectStoreList

	return declare("dojox.mobile.RoundRectStoreList", [RoundRectList, StoreListMixin], {
		// summary:
		//		A dojo/store-enabled version of RoundRectList.
		// description:
		//		RoundRectStoreList is a subclass of RoundRectList which
		//		can generate ListItems according to the given dojo/store store.
	});
});

},
'dojox/mobile/_StoreListMixin':function(){
define([
	"dojo/_base/array",
	"dojo/_base/declare",
	"./_StoreMixin",
	"./ListItem",
	"dojo/has",
	"dojo/has!dojo-bidi?dojox/mobile/bidi/_StoreListMixin"
], function(array, declare, StoreMixin, ListItem, has, BidiStoreListMixin){

	// module:
	//		dojox/mobile/_StoreListMixin

	var _StoreListMixin = declare(has("dojo-bidi") ? "dojox.mobile._NonBidiStoreListMixin" : "dojox.mobile._StoreListMixin", StoreMixin, {
		// summary:
		//		Mixin for widgets to generate the list items corresponding to
		//		the dojo/store data provider object.
		// description:
		//		Mixin for widgets to generate the list items corresponding to
		//		the dojo/store data provider object.
		//		By mixing this class into the widgets, the list item nodes are
		//		generated as the child nodes of the widget and automatically
		//		regenerated whenever the corresponding data items are modified.

		// append: Boolean
		//		If true, refresh() does not clear the existing items.
		append: false,

		// itemMap: Object
		//		An optional parameter mapping field names from the store to ItemList names.
		//		Example: itemMap:{text:'label', profile_image_url:'icon'}
		itemMap: null,

		// itemRenderer: ListItem class or subclass
		//		The class used to create list items. Default is dojox/mobile/ListItem.
		itemRenderer: ListItem,

		buildRendering: function(){
			this.inherited(arguments);
			if(!this.store){ return; }
			var store = this.store;
			this.store = null;
			this.setStore(store, this.query, this.queryOptions);
		},

		createListItem: function(/*Object*/item){
			// summary:
			//		Creates a list item widget.
			return new this.itemRenderer(this._createItemProperties(item));
		},
		
		_createItemProperties: function(/*Object*/item){
			// summary:
			//		Creates list item properties.
			var props = {};
			if(!item["label"]){
				props["label"] = item[this.labelProperty];
			}
			// TODO this code should be like for textDir in the bidi mixin createListItem method
			// however for that dynamic set/get of the dir property must be supported first
			// that is why for now as a workaround we keep the code here
			if(has("dojo-bidi") && typeof props["dir"] == "undefined"){
				props["dir"] = this.isLeftToRight() ? "ltr" : "rtl";
			}
			for(var name in item){
				props[(this.itemMap && this.itemMap[name]) || name] = item[name];
			}
			return props;
		},
		
		_setDirAttr: function(props){
			// summary:
			//		Set the 'dir' attribute to support Mirroring.
			//		To be implemented by the bidi/_StoreLisMixin.js
			return props;
		},
		generateList: function(/*Array*/items){
			// summary:
			//		Given the data, generates a list of items.
			if(!this.append){
				array.forEach(this.getChildren(), function(child){
					child.destroyRecursive();
				});
			}
			array.forEach(items, function(item, index){
				this.addChild(this.createListItem(item));
				if(item[this.childrenProperty]){
					array.forEach(item[this.childrenProperty], function(child, index){
						this.addChild(this.createListItem(child));
					}, this);
				}
			}, this);
		},

		onComplete: function(/*Array*/items){
			// summary:
			//		A handler that is called after the fetch completes.
			this.generateList(items);
		},

		onError: function(/*Object*/ /*===== errorData =====*/){
			// summary:
			//		An error handler.
		},

		onAdd: function(/*Object*/item, /*Number*/insertedInto){
			// summary:
			//		Calls createListItem and adds the new list item when a new data item has been added to the store.
			this.addChild(this.createListItem(item), insertedInto);
		},

		onUpdate: function(/*Object*/item, /*Number*/insertedInto){
			// summary:
			//		Updates an existing list item when a data item has been modified.
			this.getChildren()[insertedInto].set(this._createItemProperties(item));
		},

		onDelete: function(/*Object*/item, /*Number*/removedFrom){
			// summary:
			//		Deletes an existing item.
			this.getChildren()[removedFrom].destroyRecursive();
		}
	});
	return has("dojo-bidi") ? declare("dojox.mobile._StoreListMixin", [_StoreListMixin, BidiStoreListMixin]) : _StoreListMixin;	
});

},
'dojox/mobile/_StoreMixin':function(){
define([
	"dojo/_base/Deferred",
	"dojo/_base/declare"
], function(Deferred, declare){

	// module:
	//		dojox/mobile/_StoreMixin

	return declare("dojox.mobile._StoreMixin", null, {
		// summary:
		//		Mixin for widgets to enable dojo/store data store.
		// description:
		//		By mixing this class into a widget, it can get data through a
		//		dojo/store data store. The widget must implement the following
		//		methods to handle the retrieved data:
		//
		//		- onComplete(/*Array*/items), onError(/*Object*/errorData),
		//		- onUpdate(/*Object*/item, /*Number*/insertedInto), and
		//		- onDelete(/*Object*/item, /*Number*/removedFrom).
	
		// store: Object
		//		Reference to data provider object used by this widget.
		store: null,

		// query: Object
		//		A query that can be passed to 'store' to initially filter the items.
		query: null,

		// queryOptions: Object
		//		An optional parameter for the query.
		queryOptions: null,

		// labelProperty: String
		//		A property name (a property in the dojo/store item) that specifies that item's label.
		labelProperty: "label",

		// childrenProperty: String
		//		A property name (a property in the dojo/store item) that specifies that item's children.
		childrenProperty: "children",

		setStore: function(/*dojo/store/api/Store*/store, /*String*/query, /*Object*/queryOptions){
			// summary:
			//		Sets the store to use with this widget.
			if(store === this.store){ return null; }
			if(store){
				store.getValue = function(item, property){
					return item[property];
				};
			}
			this.store = store;
			this._setQuery(query, queryOptions);
			return this.refresh();
		},

		setQuery: function(/*String*/query, /*Object*/queryOptions){
			this._setQuery(query, queryOptions);
			return this.refresh();
		},

		_setQuery: function(/*String*/query, /*Object*/queryOptions){
			// tags:
			//		private
			this.query = query;
			this.queryOptions = queryOptions || this.queryOptions;
		},

		refresh: function(){
			// summary:
			//		Fetches the data and generates the list items.
			if(!this.store){ return null; }
			var _this = this;
			var promise = this.store.query(this.query, this.queryOptions);
			if(this._observe_h){
				this._observe_h.remove();
			}
			Deferred.when(promise, function(results){
				if(results.items){
					results = results.items; // looks like dojo/data style items array
				}
				if(promise.observe){
					_this._observe_h = promise.observe(function(object, previousIndex, newIndex){
						if(previousIndex != -1){
							if(newIndex != previousIndex){
								// item removed or moved
								_this.onDelete(object, previousIndex);
								// TODO: support move, i.e. newIndex != -1?
							}else{
								// item modified
								// if onAdd is not defined, we are "bug compatible" with 1.8 and we do nothing.
								// TODO remove test in 2.0
								if(_this.onAdd){
									_this.onUpdate(object, newIndex);
								}
							}
						}else if(newIndex != -1){
							// item added
							if(_this.onAdd){
								 // new widget with onAdd method defined
								_this.onAdd(object, newIndex);
							}else{
								// TODO remove in 2.0
								// compatibility with 1.8: onAdd did not exist, add was handled by onUpdate
								_this.onUpdate(object, newIndex);
							}
						}												
					}, true); // we want to be notified of updates
				}
				_this.onComplete(results);
			}, function(error){
				_this.onError(error);
			});
			return promise;
		}

/*=====
		// Subclass MUST implement the following methods.

		, onComplete: function(items){
			// summary:
			//		A handler that is called after the fetch completes.
		},

		onError: function(errorData){
			// summary:
			//		An error handler.
		},

		onUpdate: function(item, insertedInto){
			// summary:
			//		Called when an existing data item has been modified in the store.
			//		Note: for compatibility with previous versions where only onUpdate was present,
			//		if onAdd is not defined, onUpdate will be called instead.
		},

		onDelete: function(item, removedFrom){
			// summary:
			//		Called when a data item has been removed from the store.
		},
		
		// Subclass should implement the following methods.

		onAdd: function(item, insertedInto){
			// summary:
			//		Called when a new data item has been added to the store.
			//		Note: for compatibility with previous versions where this function did not exist,
			//		if onAdd is not defined, onUpdate will be called instead.
		}
=====*/
	});
});

},
'dojo/i18n':function(){
define(["./_base/kernel", "require", "./has", "./_base/array", "./_base/config", "./_base/lang", "./_base/xhr", "./json", "module"],
	function(dojo, require, has, array, config, lang, xhr, json, module){

	// module:
	//		dojo/i18n

	has.add("dojo-preload-i18n-Api",
		// if true, define the preload localizations machinery
		1
	);

	 1 || has.add("dojo-v1x-i18n-Api",
		// if true, define the v1.x i18n functions
		1
	);

	var
		thisModule = dojo.i18n =
			{
				// summary:
				//		This module implements the dojo/i18n! plugin and the v1.6- i18n API
				// description:
				//		We choose to include our own plugin to leverage functionality already contained in dojo
				//		and thereby reduce the size of the plugin compared to various loader implementations. Also, this
				//		allows foreign AMD loaders to be used without their plugins.
			},

		nlsRe =
			// regexp for reconstructing the master bundle name from parts of the regexp match
			// nlsRe.exec("foo/bar/baz/nls/en-ca/foo") gives:
			// ["foo/bar/baz/nls/en-ca/foo", "foo/bar/baz/nls/", "/", "/", "en-ca", "foo"]
			// nlsRe.exec("foo/bar/baz/nls/foo") gives:
			// ["foo/bar/baz/nls/foo", "foo/bar/baz/nls/", "/", "/", "foo", ""]
			// so, if match[5] is blank, it means this is the top bundle definition.
			// courtesy of http://requirejs.org
			/(^.*(^|\/)nls)(\/|$)([^\/]*)\/?([^\/]*)/,

		getAvailableLocales = function(
			root,
			locale,
			bundlePath,
			bundleName
		){
			// summary:
			//		return a vector of module ids containing all available locales with respect to the target locale
			//		For example, assuming:
			//
			//		- the root bundle indicates specific bundles for "fr" and "fr-ca",
			//		-  bundlePath is "myPackage/nls"
			//		- bundleName is "myBundle"
			//
			//		Then a locale argument of "fr-ca" would return
			//
			//			["myPackage/nls/myBundle", "myPackage/nls/fr/myBundle", "myPackage/nls/fr-ca/myBundle"]
			//
			//		Notice that bundles are returned least-specific to most-specific, starting with the root.
			//
			//		If root===false indicates we're working with a pre-AMD i18n bundle that doesn't tell about the available locales;
			//		therefore, assume everything is available and get 404 errors that indicate a particular localization is not available

			for(var result = [bundlePath + bundleName], localeParts = locale.split("-"), current = "", i = 0; i<localeParts.length; i++){
				current += (current ? "-" : "") + localeParts[i];
				if(!root || root[current]){
					result.push(bundlePath + current + "/" + bundleName);
					result.specificity = current;
				}
			}
			return result;
		},

		cache = {},

		getBundleName = function(moduleName, bundleName, locale){
			locale = locale ? locale.toLowerCase() : dojo.locale;
			moduleName = moduleName.replace(/\./g, "/");
			bundleName = bundleName.replace(/\./g, "/");
			return (/root/i.test(locale)) ?
				(moduleName + "/nls/" + bundleName) :
				(moduleName + "/nls/" + locale + "/" + bundleName);
		},

		getL10nName = dojo.getL10nName = function(moduleName, bundleName, locale){
			return moduleName = module.id + "!" + getBundleName(moduleName, bundleName, locale);
		},

		doLoad = function(require, bundlePathAndName, bundlePath, bundleName, locale, load){
			// summary:
			//		get the root bundle which instructs which other bundles are required to construct the localized bundle
			require([bundlePathAndName], function(root){
				var current = lang.clone(root.root),
					availableLocales = getAvailableLocales(!root._v1x && root, locale, bundlePath, bundleName);
				require(availableLocales, function(){
					for (var i = 1; i<availableLocales.length; i++){
						current = lang.mixin(lang.clone(current), arguments[i]);
					}
					// target may not have been resolve (e.g., maybe only "fr" exists when "fr-ca" was requested)
					var target = bundlePathAndName + "/" + locale;
					cache[target] = current;
					current.$locale = availableLocales.specificity;
					load();
				});
			});
		},

		normalize = function(id, toAbsMid){
			// summary:
			//		id may be relative.
			//		preload has form `*preload*<path>/nls/<module>*<flattened locales>` and
			//		therefore never looks like a relative
			return /^\./.test(id) ? toAbsMid(id) : id;
		},

		getLocalesToLoad = function(targetLocale){
			var list = config.extraLocale || [];
			list = lang.isArray(list) ? list : [list];
			list.push(targetLocale);
			return list;
		},

		load = function(id, require, load){
			// summary:
			//		id is in one of the following formats
			//
			//		1. <path>/nls/<bundle>
			//			=> load the bundle, localized to config.locale; load all bundles localized to
			//			config.extraLocale (if any); return the loaded bundle localized to config.locale.
			//
			//		2. <path>/nls/<locale>/<bundle>
			//			=> load then return the bundle localized to <locale>
			//
			//		3. *preload*<path>/nls/<module>*<JSON array of available locales>
			//			=> for config.locale and all config.extraLocale, load all bundles found
			//			in the best-matching bundle rollup. A value of 1 is returned, which
			//			is meaningless other than to say the plugin is executing the requested
			//			preloads
			//
			//		In cases 1 and 2, <path> is always normalized to an absolute module id upon entry; see
			//		normalize. In case 3, it <path> is assumed to be absolute; this is arranged by the builder.
			//
			//		To load a bundle means to insert the bundle into the plugin's cache and publish the bundle
			//		value to the loader. Given <path>, <bundle>, and a particular <locale>, the cache key
			//
			//			<path>/nls/<bundle>/<locale>
			//
			//		will hold the value. Similarly, then plugin will publish this value to the loader by
			//
			//			define("<path>/nls/<bundle>/<locale>", <bundle-value>);
			//
			//		Given this algorithm, other machinery can provide fast load paths be preplacing
			//		values in the plugin's cache, which is public. When a load is demanded the
			//		cache is inspected before starting any loading. Explicitly placing values in the plugin
			//		cache is an advanced/experimental feature that should not be needed; use at your own risk.
			//
			//		For the normal AMD algorithm, the root bundle is loaded first, which instructs the
			//		plugin what additional localized bundles are required for a particular locale. These
			//		additional locales are loaded and a mix of the root and each progressively-specific
			//		locale is returned. For example:
			//
			//		1. The client demands "dojo/i18n!some/path/nls/someBundle
			//
			//		2. The loader demands load(some/path/nls/someBundle)
			//
			//		3. This plugin require's "some/path/nls/someBundle", which is the root bundle.
			//
			//		4. Assuming config.locale is "ab-cd-ef" and the root bundle indicates that localizations
			//		are available for "ab" and "ab-cd-ef" (note the missing "ab-cd", then the plugin
			//		requires "some/path/nls/ab/someBundle" and "some/path/nls/ab-cd-ef/someBundle"
			//
			//		5. Upon receiving all required bundles, the plugin constructs the value of the bundle
			//		ab-cd-ef as...
			//
			//				mixin(mixin(mixin({}, require("some/path/nls/someBundle"),
			//		  			require("some/path/nls/ab/someBundle")),
			//					require("some/path/nls/ab-cd-ef/someBundle"));
			//
			//		This value is inserted into the cache and published to the loader at the
			//		key/module-id some/path/nls/someBundle/ab-cd-ef.
			//
			//		The special preload signature (case 3) instructs the plugin to stop servicing all normal requests
			//		(further preload requests will be serviced) until all ongoing preloading has completed.
			//
			//		The preload signature instructs the plugin that a special rollup module is available that contains
			//		one or more flattened, localized bundles. The JSON array of available locales indicates which locales
			//		are available. Here is an example:
			//
			//			*preload*some/path/nls/someModule*["root", "ab", "ab-cd-ef"]
			//
			//		This indicates the following rollup modules are available:
			//
			//			some/path/nls/someModule_ROOT
			//			some/path/nls/someModule_ab
			//			some/path/nls/someModule_ab-cd-ef
			//
			//		Each of these modules is a normal AMD module that contains one or more flattened bundles in a hash.
			//		For example, assume someModule contained the bundles some/bundle/path/someBundle and
			//		some/bundle/path/someOtherBundle, then some/path/nls/someModule_ab would be expressed as follows:
			//
			//			define({
			//				some/bundle/path/someBundle:<value of someBundle, flattened with respect to locale ab>,
			//				some/bundle/path/someOtherBundle:<value of someOtherBundle, flattened with respect to locale ab>,
			//			});
			//
			//		E.g., given this design, preloading for locale=="ab" can execute the following algorithm:
			//
			//			require(["some/path/nls/someModule_ab"], function(rollup){
			//				for(var p in rollup){
			//					var id = p + "/ab",
			//					cache[id] = rollup[p];
			//					define(id, rollup[p]);
			//				}
			//			});
			//
			//		Similarly, if "ab-cd" is requested, the algorithm can determine that "ab" is the best available and
			//		load accordingly.
			//
			//		The builder will write such rollups for every layer if a non-empty localeList  profile property is
			//		provided. Further, the builder will include the following cache entry in the cache associated with
			//		any layer.
			//
			//			"*now":function(r){r(['dojo/i18n!*preload*<path>/nls/<module>*<JSON array of available locales>']);}
			//
			//		The *now special cache module instructs the loader to apply the provided function to context-require
			//		with respect to the particular layer being defined. This causes the plugin to hold all normal service
			//		requests until all preloading is complete.
			//
			//		Notice that this algorithm is rarely better than the standard AMD load algorithm. Consider the normal case
			//		where the target locale has a single segment and a layer depends on a single bundle:
			//
			//		Without Preloads:
			//
			//		1. Layer loads root bundle.
			//		2. bundle is demanded; plugin loads single localized bundle.
			//
			//		With Preloads:
			//
			//		1. Layer causes preloading of target bundle.
			//		2. bundle is demanded; service is delayed until preloading complete; bundle is returned.
			//
			//		In each case a single transaction is required to load the target bundle. In cases where multiple bundles
			//		are required and/or the locale has multiple segments, preloads still requires a single transaction whereas
			//		the normal path requires an additional transaction for each additional bundle/locale-segment. However all
			//		of these additional transactions can be done concurrently. Owing to this analysis, the entire preloading
			//		algorithm can be discard during a build by setting the has feature dojo-preload-i18n-Api to false.

			if(has("dojo-preload-i18n-Api")){
				var split = id.split("*"),
					preloadDemand = split[1] == "preload";
				if(preloadDemand){
					if(!cache[id]){
						// use cache[id] to prevent multiple preloads of the same preload; this shouldn't happen, but
						// who knows what over-aggressive human optimizers may attempt
						cache[id] = 1;
						preloadL10n(split[2], json.parse(split[3]), 1, require);
					}
					// don't stall the loader!
					load(1);
				}
				if(preloadDemand || waitForPreloads(id, require, load)){
					return;
				}
			}

			var match = nlsRe.exec(id),
				bundlePath = match[1] + "/",
				bundleName = match[5] || match[4],
				bundlePathAndName = bundlePath + bundleName,
				localeSpecified = (match[5] && match[4]),
				targetLocale =	localeSpecified || dojo.locale || "",
				loadTarget = bundlePathAndName + "/" + targetLocale,
				loadList = localeSpecified ? [targetLocale] : getLocalesToLoad(targetLocale),
				remaining = loadList.length,
				finish = function(){
					if(!--remaining){
						load(lang.delegate(cache[loadTarget]));
					}
				};
			array.forEach(loadList, function(locale){
				var target = bundlePathAndName + "/" + locale;
				if(has("dojo-preload-i18n-Api")){
					checkForLegacyModules(target);
				}
				if(!cache[target]){
					doLoad(require, bundlePathAndName, bundlePath, bundleName, locale, finish);
				}else{
					finish();
				}
			});
		};

	if(has("dojo-unit-tests")){
		var unitTests = thisModule.unitTests = [];
	}

	if(has("dojo-preload-i18n-Api") ||  1 ){
		var normalizeLocale = thisModule.normalizeLocale = function(locale){
				var result = locale ? locale.toLowerCase() : dojo.locale;
				return result == "root" ? "ROOT" : result;
			},

			isXd = function(mid, contextRequire){
				return ( 0  &&  1 ) ?
					contextRequire.isXdUrl(require.toUrl(mid + ".js")) :
					true;
			},

			preloading = 0,

			preloadWaitQueue = [],

			preloadL10n = thisModule._preloadLocalizations = function(/*String*/bundlePrefix, /*Array*/localesGenerated, /*boolean?*/ guaranteedAmdFormat, /*function?*/ contextRequire){
				// summary:
				//		Load available flattened resource bundles associated with a particular module for dojo/locale and all dojo/config.extraLocale (if any)
				// description:
				//		Only called by built layer files. The entire locale hierarchy is loaded. For example,
				//		if locale=="ab-cd", then ROOT, "ab", and "ab-cd" are loaded. This is different than v1.6-
				//		in that the v1.6- would only load ab-cd...which was *always* flattened.
				//
				//		If guaranteedAmdFormat is true, then the module can be loaded with require thereby circumventing the detection algorithm
				//		and the extra possible extra transaction.

				// If this function is called from legacy code, then guaranteedAmdFormat and contextRequire will be undefined. Since the function
				// needs a require in order to resolve module ids, fall back to the context-require associated with this dojo/i18n module, which
				// itself may have been mapped.
				contextRequire = contextRequire || require;

				function doRequire(mid, callback){
					if(isXd(mid, contextRequire) || guaranteedAmdFormat){
						contextRequire([mid], callback);
					}else{
						syncRequire([mid], callback, contextRequire);
					}
				}

				function forEachLocale(locale, func){
					// given locale= "ab-cd-ef", calls func on "ab-cd-ef", "ab-cd", "ab", "ROOT"; stops calling the first time func returns truthy
					var parts = locale.split("-");
					while(parts.length){
						if(func(parts.join("-"))){
							return;
						}
						parts.pop();
					}
					func("ROOT");
				}

				function preload(locale){
					locale = normalizeLocale(locale);
					forEachLocale(locale, function(loc){
						if(array.indexOf(localesGenerated, loc)>=0){
							var mid = bundlePrefix.replace(/\./g, "/")+"_"+loc;
							preloading++;
							doRequire(mid, function(rollup){
								for(var p in rollup){
									cache[require.toAbsMid(p) + "/" + loc] = rollup[p];
								}
								--preloading;
								while(!preloading && preloadWaitQueue.length){
									load.apply(null, preloadWaitQueue.shift());
								}
							});
							return true;
						}
						return false;
					});
				}

				preload();
				array.forEach(dojo.config.extraLocale, preload);
			},

			waitForPreloads = function(id, require, load){
				if(preloading){
					preloadWaitQueue.push([id, require, load]);
				}
				return preloading;
			},

			checkForLegacyModules = function()
				{};
	}

	if( 1 ){
		// this code path assumes the dojo loader and won't work with a standard AMD loader
		var amdValue = {},
			evalBundle =
				// use the function ctor to keep the minifiers away (also come close to global scope, but this is secondary)
				new Function(
					"__bundle",				   // the bundle to evalutate
					"__checkForLegacyModules", // a function that checks if __bundle defined __mid in the global space
					"__mid",				   // the mid that __bundle is intended to define
					"__amdValue",

					// returns one of:
					//		1 => the bundle was an AMD bundle
					//		a legacy bundle object that is the value of __mid
					//		instance of Error => could not figure out how to evaluate bundle

					  // used to detect when __bundle calls define
					  "var define = function(mid, factory){define.called = 1; __amdValue.result = factory || mid;},"
					+ "	   require = function(){define.called = 1;};"

					+ "try{"
					+		"define.called = 0;"
					+		"eval(__bundle);"
					+		"if(define.called==1)"
								// bundle called define; therefore signal it's an AMD bundle
					+			"return __amdValue;"

					+		"if((__checkForLegacyModules = __checkForLegacyModules(__mid)))"
								// bundle was probably a v1.6- built NLS flattened NLS bundle that defined __mid in the global space
					+			"return __checkForLegacyModules;"

					+ "}catch(e){}"
					// evaulating the bundle was *neither* an AMD *nor* a legacy flattened bundle
					// either way, re-eval *after* surrounding with parentheses

					+ "try{"
					+		"return eval('('+__bundle+')');"
					+ "}catch(e){"
					+		"return e;"
					+ "}"
				),

			syncRequire = function(deps, callback, require){
				var results = [];
				array.forEach(deps, function(mid){
					var url = require.toUrl(mid + ".js");

					function load(text){
						var result = evalBundle(text, checkForLegacyModules, mid, amdValue);
						if(result===amdValue){
							// the bundle was an AMD module; re-inject it through the normal AMD path
							// we gotta do this since it could be an anonymous module and simply evaluating
							// the text here won't provide the loader with the context to know what
							// module is being defined()'d. With browser caching, this should be free; further
							// this entire code path can be circumvented by using the AMD format to begin with
							results.push(cache[url] = amdValue.result);
						}else{
							if(result instanceof Error){
								console.error("failed to evaluate i18n bundle; url=" + url, result);
								result = {};
							}
							// nls/<locale>/<bundle-name> indicates not the root.
							results.push(cache[url] = (/nls\/[^\/]+\/[^\/]+$/.test(url) ? result : {root:result, _v1x:1}));
						}
					}

					if(cache[url]){
						results.push(cache[url]);
					}else{
						var bundle = require.syncLoadNls(mid);
						// don't need to check for legacy since syncLoadNls returns a module if the module
						// (1) was already loaded, or (2) was in the cache. In case 1, if syncRequire is called
						// from getLocalization --> load, then load will have called checkForLegacyModules() before
						// calling syncRequire; if syncRequire is called from preloadLocalizations, then we
						// don't care about checkForLegacyModules() because that will be done when a particular
						// bundle is actually demanded. In case 2, checkForLegacyModules() is never relevant
						// because cached modules are always v1.7+ built modules.
						if(bundle){
							results.push(bundle);
						}else{
							if(!xhr){
								try{
									require.getText(url, true, load);
								}catch(e){
									results.push(cache[url] = {});
								}
							}else{
								xhr.get({
									url:url,
									sync:true,
									load:load,
									error:function(){
										results.push(cache[url] = {});
									}
								});
							}
						}
					}
				});
				callback && callback.apply(null, results);
			};

		checkForLegacyModules = function(target){
			// legacy code may have already loaded [e.g] the raw bundle x/y/z at x.y.z; when true, push into the cache
			for(var result, names = target.split("/"), object = dojo.global[names[0]], i = 1; object && i<names.length-1; object = object[names[i++]]){}
			if(object){
				result = object[names[i]];
				if(!result){
					// fallback for incorrect bundle build of 1.6
					result = object[names[i].replace(/-/g,"_")];
				}
				if(result){
					cache[target] = result;
				}
			}
			return result;
		};

		thisModule.getLocalization = function(moduleName, bundleName, locale){
			var result,
				l10nName = getBundleName(moduleName, bundleName, locale);
			load(
				l10nName,

				// isXd() and syncRequire() need a context-require in order to resolve the mid with respect to a reference module.
				// Since this legacy function does not have the concept of a reference module, resolve with respect to this
				// dojo/i18n module, which, itself may have been mapped.
				(!isXd(l10nName, require) ? function(deps, callback){ syncRequire(deps, callback, require); } : require),

				function(result_){ result = result_; }
			);
			return result;
		};

		if(has("dojo-unit-tests")){
			unitTests.push(function(doh){
				doh.register("tests.i18n.unit", function(t){
					var check;

					check = evalBundle("{prop:1}", checkForLegacyModules, "nonsense", amdValue);
					t.is({prop:1}, check); t.is(undefined, check[1]);

					check = evalBundle("({prop:1})", checkForLegacyModules, "nonsense", amdValue);
					t.is({prop:1}, check); t.is(undefined, check[1]);

					check = evalBundle("{'prop-x':1}", checkForLegacyModules, "nonsense", amdValue);
					t.is({'prop-x':1}, check); t.is(undefined, check[1]);

					check = evalBundle("({'prop-x':1})", checkForLegacyModules, "nonsense", amdValue);
					t.is({'prop-x':1}, check); t.is(undefined, check[1]);

					check = evalBundle("define({'prop-x':1})", checkForLegacyModules, "nonsense", amdValue);
					t.is(amdValue, check); t.is({'prop-x':1}, amdValue.result);

					check = evalBundle("define('some/module', {'prop-x':1})", checkForLegacyModules, "nonsense", amdValue);
					t.is(amdValue, check); t.is({'prop-x':1}, amdValue.result);

					check = evalBundle("this is total nonsense and should throw an error", checkForLegacyModules, "nonsense", amdValue);
					t.is(check instanceof Error, true);
				});
			});
		}
	}

	return lang.mixin(thisModule, {
		dynamic:true,
		normalize:normalize,
		load:load,
		cache:cache,
		getL10nName: getL10nName
	});
});

},
'url:app/config.json':"{\n    //Mandatory\n    \"id\": \"App\",\n    //Optional\n    \"name\": \"Boilerplate-App\",\n    //Optional\n    \"description\": \"Sample Boilerplate-App to help devs get starteds\",\n    //Optional, but very useful for views properties\n    \"loaderConfig\": {\n        \"paths\": {\n            \"app\": \"../app\"\n        }\n    },\n    /*\n    //Optional, default is \"dojox/css3/transit\"\n    \"transit\": \"dojox/css3/transit\",\n    */\n    //Optional, but required when not using the parser, and its required by views\n    \"dependencies\": [\n        \"dojo/store/Observable\",\n        \"dojox/app/controllers/History\",\n        \"dojox/app/controllers/HistoryHash\",\n        /* On Mobile always add the 2 following modules dojox/mobule a dojox/mobile/deviceTheme */\n        \"dojox/mobile/common\",\n        \"dojox/mobile/deviceTheme\",\n        /* For build to include css3/lite query selectorEngine */\n        \"dojo/selector/lite\",\n        //Need to inlclude dependency for model stores across views\n        \"dojo/store/Memory\"\n\n    ],\n    //Optional, they get mixed into the Application, mixes after dojox/app/module/lifecycle\n    \"modules\": [\n    ],\n    //Mandatory, they listen to App.emit events, they implement dojox/app/Controller\n    \"controllers\": [\n        //listens to \"app-init, app-load\"\n        \"dojox/app/controllers/Load\",\n        //listens to \"app-transition, app-domNode\"\n        \"dojox/app/controllers/Transition\",\n        //listens to \"app-initLayout,app-layoutVIew,app-resize\"\n        \"dojox/app/controllers/Layout\"\n    ],\n    //Optional, App levels stores shared with views\n    \"stores\": {\n        \"store1\":{\n            \"type\": \"dojo/store/Memory\",\n            //\"observable\": true,\n            \"params\": { // parameters used to initialize the data store\n                \"data\": \"myapp.dataItems\"\n            }\n        },\n        \"store2\":{\n            \"type\": \"dojo/store/Memory\",\n            //\"observable\": true,\n            \"params\": { // parameters used to initialize the data store\n                \"data\": [{\"label\":\"North Carolina\", \"rightText\":\"Raleigh\"},\n                         {\"label\":\"Virginia\",       \"rightText\":\"Richmond\"}\n                        ],\n                \"idProperty\":\"label\"\n            }\n        }\n    },\n\n    //Optional\n    \"template\": \"app/views/app.html\",\n\n    //Optional, other examples are \"flip, none\"\n    \"defaultTransition\": \"slide\",\n    //Mandatory, one or a set of views view1+view2+view3\n    \"defaultView\": \"view1\",\n\n    //Optional, App level stings\n    \"nls\": \"app/nls/app_strings\",\n    //Mandatory, Specify Application child views\n    \"views\": {\n        \"view1\":{\n            //Mandatory for defaultViews\n            \"template\": \"app/views/view1/view1.html\",\n\n            //Optional, listens to View.emit events\n            //  init\n            //  beforeActivate\n            //  afterActivate\n            //  beforeDeactivate\n            //  afterDeactivate\n            //  destroy\n            //Optional controller\n            \"controller\": \"app/views/view1/view1Ctrl.js\",\n            //Optional, overwrites the transition type only for this view\n            \"transition\": \"slide\",\n            //Optional, view level strings they get mixed into global nls object\n            \"nls\": \"app/views/view1/nls/view1_strings\",\n            //Optional, dependencies for this specific view, declare in template\n            \"dependencies\":[\n                \"dojox/mobile/RoundRectList\",\n                \"dojox/mobile/ListItem\",\n                \"dojox/mobile/Button\",\n                \"dojox/mobile/RoundRectStoreList\"\n                ]\n        },\n        \"view2\":{\n            //Mandatory for defaultViews\n            \"template\": \"app/views/view2/view2.html\",\n             \"transition\": \"slide\"\n        }\n    },\n    \"has\": {\n        \"html5history\": {\n            \"controllers\": [\n                \"dojox/app/controllers/History\"\n            ]\n        },\n        \"!html5history\": {\n            \"controllers\": [\n                \"dojox/app/controllers/HistoryHash\"\n            ]\n        }\n    }\n}\n",
'url:app/resources/data/items.json':"{\n    \"identifier\": \"id\",\n    \"items\": [\n        {\n            \"id\": \"10001\",\n            \"label\": \"Foo\",\n            \"rightText\": \"1.0\"\n        },\n        {\n            \"id\": \"10002\",\n            \"label\": \"Bar\",\n            \"rightText\": \"2.0\"\n        }\n    ]\n}",
'url:app/views/app.html':"<div>\n    <div class=\"navPane\" data-app-constraint=\"top\">\n        <select id=\"sel1\" onchange=\"(function changeTheme(){location.replace('?theme='+event.target.value);}())\"> \n            <option value=\"\">${nls.switch_theme}</option>\n            <option value=\"iPhone\">iPhone</option>\n            <option value=\"iPad\">iPad</option>\n            <option value=\"Android\">Android</option>\n            <option value=\"Holodark\">Holodark</option>\n            <option value=\"BlackBerry\">BlackBerry</option>\n            <option value=\"WindowsPhone\">WindowsPhone</option>\n            <option value=\"Custom\">${nls.custom}</option>\n\t    </select>\n        <br>\n        <div>${nls.app_template_title}</div>\n        <div>${nls.app_string}</div>\n    </div>\n\n</div>\n",
'url:app/views/view1/view1.html':"<div class=\"view view1 mblView\">\n\n    <!-- Access View properties and nls strings without a View Controller -->\n    <div>$ {nls.view1_template_title} = ${nls.view1_template_title}</div>\n    <div>$ {name} = ${name}</div>\n    <div>$ {template} = ${template}</div>\n    <div>$ {nls.app_string} = ${nls.app_string}</div>\n    <div>$ {nls.view1_string} = ${nls.view1_string}</div>\n\n\n    <!-- Access primitive properties from View Controller -->\n    <!-- As defined on View Controller\n    'aNumber'    : 42,\n    'aString'    : 'aString',\n    'aStringScapedQuotes'    : 'Got to View 2:<a href=\"index.html#view2\">click</a>',\n    'aBoolean'   : true,\n    'aNull'      : null,\n    -->\n    <div>$ {aNumber}  = ${aNumber}</div>\n    <div>$ {aString} = ${aString}</div>\n    <div>$ {aString:_formatterTmpl} = ${aString:_formatterTmpl}</div>\n    <div>$ {!aStringScapedQuotes} = ${!aStringScapedQuotes}</div>\n    <div>$ {aBoolean} = ${aBoolean}</div>\n    <div>$ {aNull} = ${aNull}</div>\n    <div>$ {aNull:_formatterTmpl} = ${aNull:_formatterTmpl}</div>\n\n    <!-- Access A different locale -->\n    <a href=\"${nls.locale_link}\"> Click to change locale: ${nls.locale_link}</a>\n\n    <!-- Transition to a different view using ListItem 'startTransition' Event -->\n    <ul data-dojo-type=\"dojox/mobile/RoundRectList\">\n        <li data-dojo-type=\"dojox/mobile/ListItem\" data-dojo-props=\"clickable:true,target:'view2',url:'#view2'\">\n            Go to View 2\n        </li>\n    </ul>\n\n    <!-- Access functions on the View Controller -->\n    <ul data-dojo-type=\"dojox/mobile/RoundRectList\">\n        <!-- Run function from View Controller by assigning ListItem onClick to a function -->\n        <li data-dojo-type=\"dojox/mobile/Button\" data-dojo-attach-event=\"onClick:doSomething\" data-dojo-props='clickable:true,noArrow:true'>\n        doSomething()\n        </li>\n    </ul>\n\n    <!-- View Controller will use id to attach an Event listener on button -->\n    <button id=\"doSomethingOnce\">\n     doSomething on.once\n    </button>\n    <input type=\"text\" />\n</div>\n",
'url:app/views/view2/view2.html':"<div class=\"view view2\">\n    <button onclick=\"event.target.dispatchEvent(new CustomEvent('startTransition', {\n                                                'bubbles':true,\n                                                'cancelable':true,\n                                                'detail':   {\n                                                            target: 'view1',\n                                                            url: '#view1',\n                                                            transitionDir: -1\n                                                        }\n                                                }));\"\n    >\n    Back with raw js event.target.dispatchEvent()\n    </button>\n\n    <button onclick=\"App.transitionToView(event.target, {\n                                                            'target': 'view1',\n                                                            'url': '#view1',\n                                                            'transitionDir': -1\n                                                        }, event);\">\n    Back with App.transitionToView()\n    </button>\n\n    <div>${name}</div>\n    <div>${template}</div>\n    <div>${nls.app_string}</div>\n\n    <!-- Render Data from json data via dojo/store -->\n    <!-- Example loading data from .json file -->\n    <div     data-dojo-type=\"dojox/mobile/RoundRectStoreList\"\n             data-dojo-attach-point=\"dataItems\"\n             data-dojo-props=\"store: this.loadedStores.store1,\n             stateful: false\">\n    </div>\n    <!-- Example loading data from static data in config.json -->\n     <div     data-dojo-type=\"dojox/mobile/RoundRectStoreList\"\n             data-dojo-attach-point=\"dataItems\"\n             data-dojo-props=\"store: this.loadedStores.store2,\n             stateful: false\">\n    </div>\n</div>\n",
'*now':function(r){r(['dojo/i18n!*preload*app/nls/main*["ar","ca","cs","da","de","el","en","en-gb","en-us","es","es-es","fi","fi-fi","fr","fr-fr","he","he-il","hu","it","it-it","ja","ja-jp","ko","ko-kr","nl","nl-nl","nb","pl","pt","pt-br","pt-pt","ru","sk","sl","sv","th","tr","zh","zh-tw","zh-cn","ROOT"]']);}
}});
/*global define, console*/
/*jslint todo: true */
/*jshint todo: true */

/**
 * This file is the application's main JavaScript file. It is listed as a dependency in run.js and will automatically
 * load when run.js loads.
 *
 * Because this file has the special filename `main.js`, and because we've registered the `app` package in run.js,
 * whatever object this module returns can be loaded by other files simply by requiring `app` (instead of `app/main`).
 *
 * Our first dependency is to the `dojo/has` module, which allows us to conditionally execute code based on
 * configuration settings or environmental information. Unlike a normal conditional, these branches can be compiled
 * away by the build system; see `staticHasFeatures` in app.profile.js for more information.
 *
 * Our second dependency is to the special module `require`; this allows us to make additional require calls using
 * module IDs relative to this module within the body of the define callback.
 *
 * In all cases, whatever function is passed to define("app/main", ) is only invoked once, and the returned value is cached.
 *
 * More information about everything described about the loader throughout this file can be found at
 * <http://dojotoolkit.org/reference-guide/loader/amd.html>.
 */
define([
    'dojo/_base/window',
    'dojo/sniff',
    'require',
    'dojox/app/main',
    'dojox/json/ref',
    'dojo/text!app/config.json',
    'dojo/text!app/resources/data/items.json',
    //TODO: add all html templates being use in config.json to force them to be included in layer
    // when doing custom dojo build, the build process will recognize them as dependencies for the package
    'dojo/text!app/views/app.html',
    'dojo/text!app/views/view1/view1.html',
    'dojo/text!app/views/view2/view2.html',
    'dojo/domReady!'
], function (win, has, require, Application, json, config, data) {
    'use strict';
    win.global.myapp = {};

    // populate has flag on whether html5 history is correctly supported or not
    has.add("html5history", !has("ie") || has("ie") > 9);

    //TODO: Just for debugging this enables built in logging
    //has.add("app-log-api", true);

    // setup the data for the memory stores
    win.global.myapp.dataItems = json.fromJson(data);

    //Start the App
    win.global.myapp.App = new Application(json.fromJson(config));

});
