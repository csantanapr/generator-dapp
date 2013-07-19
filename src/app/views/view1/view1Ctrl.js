/*jslint nomen: true */
/*jshint nomen: true */
/*global _, define, console */
define([
    'dojo/dom',
    'dojo/dom-class',
    'dojo/on'
], function (dom, domClass, on) {
    'use strict';

    var myevents = [];


    return {
        // view init

        init: function (params) {
            // summary:
            //      view life cycle init()
            console.log("view: init()");

        },

        beforeActivate: function (view, data) {
            // summary:
            //      view life cycle beforeActivate()
            console.log("view: beforeActivate(view,data)");
        },

        afterActivate: function (view, data) {
            // summary:
            //      view life cycle afterActivate()

            var btn = dom.byId("doSomethingOnce");
            myevents.push(on.once(btn, "click", (this.doSomething).bind(this)));

            console.log("view: afterActivate(view,data)");

        },

        beforeDeactivate: function (view, data) {
            // summary:
            //      view life cycle beforeDeactivate()
            console.log("view: beforeDeactivate(view,data)");
        },

        afterDeactivate: function (view, data) {
            // summary:
            //      view life cycle afterDeactivate()
            console.log("view: afterDeactivate(view,data)");
            this.destroy();
        },

        destroy: function (params) {
            // summary:
            //      view life cycle destroy()
            console.log("view: destory()");



        },
        /*****
         * Custom Code for View Controller
         *****/

        'magicvalue' : 42,

        doSomething: function (event) {
            console.log('did something');
        },
        _removeEvents: function () {
            while (myevents.length > 0) {

                myevents.pop().remove();
            }
        }
    };
});