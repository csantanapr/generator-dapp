/*global define, console*/
define([
    'dojo/text!app/views/about/about.html',
    'dojox/mobile/Heading',
    'dojox/mobile/EdgeToEdgeList',
    'dojox/mobile/ListItem'
], function () {
    'use strict';
    return {
        init: function () {
            // summary:
            //      view life cycle init()
            console.log(this.name + " view:init()");
        },
        beforeActivate: function (previousView, data) {
            // summary:
            //      view life cycle beforeActivate()
            console.log(this.name + " view:beforeActivate(" + (previousView ? previousView.name : "") + ",data)" + data);
        },
        afterActivate: function (previousView, data) {
            // summary:
            //      view life cycle afterActivate()
            console.log(this.name + " view:afterActivate(" + (previousView ? previousView.name : "") + ",data)" + data);
        },
        beforeDeactivate: function (nextView, data) {
            // summary:
            //      view life cycle beforeDeactivate()
            console.log(this.name + " view:beforeDeactivate(" + (nextView ? nextView.name : "") + ",data)" + data);
        },
        afterDeactivate: function (nextView, data) {
            // summary:
            //      view life cycle afterDeactivate()
            console.log(this.name + " view:afterDeactivate(" + (nextView ? nextView.name : "") + ",data)" + data);
        }
    };
});
