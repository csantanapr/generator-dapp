/*jslint nomen: true */
/*jshint nomen: true */
/*global _, define, console, alert */
define([
    'dojo/query!css3',
    'dojo/on',
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
], function ($, on) {
    'use strict';

    var handles,
        viewNode,
        count = 0;


    return {

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
