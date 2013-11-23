/*jslint nomen: true */
/*global define, window, history*/

define(["dojo/_base/lang", "dojo/_base/declare", "dojox/app/Controller", "dojox/app/utils/hash", "dojo/topic"], function (lang, declare, Controller, hash, topic) {
    "use strict";
    // module:
    //      dojox/app/tests/mediaQuery3ColumnApp/controllers/CustomHistory
    // summary:
    //      This CustomHistory controller will manage the history stack so that if you return to a view target which
    //      is in the history stack already, it will update the history stack to go to that previous view in the stack.

    //      Using dojox/app/controllers/History means you can use the browser back/forward buttons to retrace all of your
    //      steps even if, for example if you select "Main Option 1" multiple times.
    //
    //      Using CustomHistory without setting customHistoryStackKey in the config means it will check to see if the current url
    //      has been used already, and if it has it will remove the things from the history stack back to the point it was
    //      last used.  So for example if you start the application in a new tab, and select "Main Option 1", then
    //      you select other options, (like "Main Option 2" and "Main Option 3") and then select
    //      "Main Option 1" again, doing a browser back after selecting "Main Option 1" the last time will take you
    //      back to the initial default page instead of the last thing before you last went to "Main Option 1".
    //
    //      Using CustomHistory and setting customHistoryStackKey to "target" in the config means it will check to see if the
    //      current target has been used already, and if it has it will remove the things from the history stack back to the
    //      point it was last used.  So for example if you start the application in a new tab, and select "Main Option 1", then
    //      you select other options, (like "Main Option 2" and "Main Option 3") and then select
    //      "Main Option 1" again, doing a browser back after selecting "Main Option 1" the last time will take you
    //      back to the initial default page instead of the last thing before you last went to "Main Option 1".
    //      The difference caused by using "target" can be seen when selecting "Last Option 1", 2 or 3, and then using the
    //      browser back button, when using "target" you will not go back through those selections, but without "target"
    //      you will go through those options because those options are set in the url, but not in the target.

    //      Bind "app-domNode" event on dojox/app application instance.
    //      Bind "startTransition" event on dojox/app application domNode.
    //      Bind "popstate" event on window object.
    //      Maintain history by HTML5 "pushState" method and "popstate" event.

    return declare("dojox/app/tests/mediaQuery3ColumnApp/controllers/CustomHistory", Controller, {
        // _currentPosition:     Integer
        //              Persistent variable which indicates the current position/index in the history
        //              (so as to be able to figure out whether the popState event was triggerd by
        //              a backward or forward action).
        _currentPosition: 0,

        // currentState: Object
        //              Current state
        currentState: {},

        // currentStack: Array
        //              Array with the history used to look for targets already in the stack
        currentStack: [],

        // currentStackKey: string
        //              boolean is true when the currentStack is being updated because the view target was already in the stack
        currentStackKey: "url",  // set "customHistoryStackKey" : "target" in the config if you want to key off of the target instead of the url

        // currentStackUpdating: boolean
        //              boolean is true when the currentStack is being updated because the view target was already in the stack
        currentStackUpdating: false,

        constructor: function () {
            // summary:
            //      Bind "app-domNode" event on dojox/app application instance.
            //      Bind "startTransition" event on dojox/app application domNode.
            //      Bind "popstate" event on window object.
            //

            this.events = {
                "app-domNode": this.onDomNodeChange
            };
            if (this.app.domNode) {
                this.onDomNodeChange({oldNode: null, newNode: this.app.domNode});
            }
            this.bind(window, "popstate", lang.hitch(this, this.onPopState));

            this.currentStackKey = this.app.customHistoryStackKey || this.currentStackKey;
        },

        onDomNodeChange: function (evt) {
            if (evt.oldNode !== null) {
                this.unbind(evt.oldNode, "startTransition");
            }
            this.bind(evt.newNode, "startTransition", lang.hitch(this, this.onStartTransition));
        },

        onStartTransition: function (evt) {
            // summary:
            //      Response to dojox/app "startTransition" event.
            //
            // example:
            //      Use "dojox/mobile/TransitionEvent" to trigger "startTransition" event, and this function will response the event. For example:
            //      |   var transOpts = {
            //      |       title:"List",
            //      |       target:"items,list",
            //      |       url: "#items,list",
            //      |       params: {"param1":"p1value"}
            //      |   };
            //      |   new TransitionEvent(domNode, transOpts, e).dispatch();
            //
            // evt: Object
            //      Transition options parameter
            var currentHash = window.location.hash,
                currentView = hash.getTarget(currentHash, this.app.defaultView),
                currentParams =  hash.getParams(currentHash),
                _detail = lang.clone(evt.detail),
                newUrl,
                testStackKey,
                idx,
                len,
                i;

            _detail.target = _detail.title = currentView;
            _detail.url = currentHash;
            _detail.params = currentParams;
            _detail.id = this._currentPosition;

            // Create initial state if necessary
            if (history.length === 1) {
                history.pushState(_detail, _detail.href, currentHash);
            }

            // Update the current state
            _detail.bwdTransition = _detail.transition;
            lang.mixin(this.currentState, _detail);
            history.replaceState(this.currentState, this.currentState.href, currentHash);

            // Create a new "current state" history entry
            this._currentPosition += 1;

            newUrl = evt.detail.url || "#" + evt.detail.target; // move up above

            if (evt.detail.params) {
                newUrl = hash.buildWithParams(newUrl, evt.detail.params);
            }

            //check to see if the hash or target based upon currentStackKey is already in the list
            testStackKey = this.currentStackKey === "target" ? evt.detail.target : newUrl;
            idx = this.currentStack.indexOf(testStackKey);
            if (idx > -1) {  // the target is in the list
                // found the target in the list, so backup to that entry
                this.currentStackUpdating = true;
                len = this.currentStack.length - idx;
                this._currentPosition -= len;
                history.go(-len);
                for (i = 0; i < len; i = i + 1) {
                    this.currentStack.pop();
                }
            }

            evt.detail.id = this._currentPosition;
            evt.detail.fwdTransition = evt.detail.transition;
            history.pushState(evt.detail, evt.detail.href, newUrl);

            if (this.currentStackKey === "target") {
                this.currentStack.push(evt.detail.target);
            } else {
                this.currentStack.push(newUrl);
            }

            this.currentState = lang.clone(evt.detail);

            // Finally: Publish pushState topic
            topic.publish("/app/history/pushState", evt.detail.target);

        },

        onPopState: function (evt) {
            // summary:
            //      Response to dojox/app "popstate" event.
            //
            // evt: Object
            //      Transition options parameter
            var opts,
                backward;
            // Clean browser's cache and refresh the current page will trigger popState event,
            // but in this situation the application has not started and throws an error.
            // So we need to check application status, if application not STARTED, do nothing.
            if ((this.app.getStatus() !== this.app.lifecycle.STARTED) || !evt.state || this.currentStackUpdating) {
                this.currentStackUpdating = false;
                return;
            }

            // Get direction of navigation and update _currentPosition accordingly
            backward = evt.state.id < this._currentPosition;
            if (backward) {
                this._currentPosition -= 1;
            } else {
                this._currentPosition += 1;
            }

            if (backward) {
                this.currentStack.pop(); // keep currentStack up to date
            } else {
                if (this.currentStackKey === "target") {
                    this.currentStack.push(evt.state.target);
                } else {
                    this.currentStack.push(evt.state.url);
                }
            }

            // Publish popState topic and transition to the target view. Important: Use correct transition.
            // Reverse transitionDir only if the user navigates backwards.
            opts = lang.mixin({reverse: backward ? true : false}, evt.state);
            opts.transition = backward ? opts.bwdTransition : opts.fwdTransition;
            this.app.emit("app-transition", {
                viewId: evt.state.target,
                opts: opts
            });
            topic.publish("/app/history/popState", evt.state.target);
        }
    });
});