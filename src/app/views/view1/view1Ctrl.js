/*jslint nomen: true */
/*jshint nomen: true */
/*global _, define, console, alert */
define([
    'dojo/query!css3',
    'dojo/on',
    'dojo/NodeList-manipulate'
], function (query, on) {
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
            on.once(query("#doSomethingOnce", viewNode), "click", this.doSomething);
            count = 0;
            // debugger;
            query('input[type="text"]', viewNode).val("iddle").style("color", "red");

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
        'aString'    : 'aString',
        'aStringScapedQuotes'    : 'Got to View 2:<a href="index.html#view2">click</a>',
        'aBoolean'   : true,
        'aNull'      : null,

        _formatterTmpl : function (value, key) {
            if (value === "aString") {
                return this.nls.view1_hello;
            }
            if (value === null) {
                return "null";
            }
            return value;

        },
        doSomething: function (event) {
            console.log('did something');
            query('input[type="text"]', viewNode).val("did something " + count);
            count = count + 1;
        }
    };
});
