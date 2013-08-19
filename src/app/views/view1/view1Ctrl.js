/*jslint nomen: true */
/*global _, define, console, alert */

define([
    'dojo/query!css3',
    //query is the core of dojo dom query
    // the return is NodeList that has full set of functions
    // most of the function have same syntax as jquery see bellow this file for summary
    'dojo/on',
    'dojo/NodeList-manipulate',     // Load dojo/NodeList-manipulate to get JQuery syntax: see below this file for function syntax
    'dojo/text!app/views/view1/view1.html',
    'dojox/mobile/RoundRectList',
    'dojox/mobile/ListItem',
    'dojox/mobile/Button',
    'dojox/mobile/RoundRectStoreList',
    'dojox/mobile/TextBox',
    'dojox/mobile/RoundRectCategory'
], function ($, on) {
    'use strict';

    var view,
        viewNode,
        count = 0;



    return {
        init: function () {
            // summary:
            //      view life cycle init()
            console.log(this.name + " view:init()");

            //save the view node in clousure to use as scope for dom manipulatation and query
            viewNode = this.domNode;
            view = this;

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

            //Atach onclick event to fire once
            // TIP: Always scope your query selector to the View using viewNode
            on.once($("#doSomethingOnce", viewNode), "click", this.doSomething);
            //If using jquery the syntaxt will be: $("#doSomethingOnce", viewNode).one("click",this.doSomething)
            //$("#doSomethingOnce",viewNode).one("click", this.doSomething);
            count = 0;

            //Use jquery syntax here .val() and .sytle() depends on loading dojo/NodeList-manipulate
            $('input[type="text"]', viewNode).val(this.nls.idle).style("color", "red");

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
        },

        destroy: function () {
            // summary:
            //      view life cycle destroy()
            console.log(this.name + " view:destory()");
        },
        /*****
         * Custom Code for View Controller
         *****/

        // JavaScript Primitives
        'aNumber'    : 42,
        'aString'    : 'JavaScript',
        'aStringScapedQuotes'    : '<a href="index.html#view2" target="_blank">index.html#view2</a>',
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
        doSomething: function () {
            console.log('did something');
            // TIP: Always scope your query selector to the View using viewNode
            //Use jquery syntax here .val() and .sytle() depends on loading dojo/NodeList-manipulate
            $('input[type="text"]', viewNode).val(" " + view.nls.doSomething + ":" + count);
            count = count + 1;
        }
    };


/*
    - dojo/NodeList-manipulate
    - Load dojo/NodeList-manipulate to get JQuery syntax:

.html( value)
.text(value)
.val(value)
.append(content)
.appendTo(query)
.prepend(content)
.prependTo(query)
.after(content)
.insertAfter(query)
.before(content)
.insertBefore(query)
.wrap(html)
.wrapAll(html)
.wrapInner(html)
.replaceAll(query)
.clone()

*/

/*  - dojo/query!css3
    - NodeList functions dojo/query returns NodeList and supports chanining
    - Read the docs or source for more info:
        - (http://dojotoolkit.org/api/1.9/dojo/NodeList)

.addClass(className) adds the specified class to every node in the list
.addClassFx(cssClass, args) Animate the effects of adding a class to all nodes in this list. see dojox.fx.addClass
.addContent(content, position) add a node, NodeList or some HTML as a string to every item in the list. Returns the original list.
.adopt(queryOrListOrNode, position) places any/all elements in queryOrListOrNode at a position relative to the first element in this list.
.after(content) Places the content after every node in the NodeList.
.andSelf() Adds the nodes from the previous dojo/NodeList to the current dojo/NodeList.
.anim(properties, duration, easing, onEnd, delay) Animate one or more CSS properties for all nodes in this list.
.animateProperty(args) Animate all elements of this NodeList across the properties specified. syntax identical to dojo.animateProperty
.append(content) appends the content to every node in the NodeList.
.appendTo(query) appends nodes in this NodeList to the nodes matched by the query passed to appendTo.
.at(index) Returns a new NodeList comprised of items in this NodeList at the given index or indices.
.attr(property, value) gets or sets the DOM attribute for every element in the NodeList.
.before(content) Places the content before every node in the NodeList.
.children(query) Returns all immediate child elements for nodes in this dojo/NodeList. Optionally takes a query to filter the child elements.
.clone() Clones all the nodes in this NodeList and returns them as a new NodeList.
.closest(query, root) Returns closest parent that matches query, including current node in this dojo/NodeList if it matches the query.
.concat(item) Returns a new NodeList comprised of items in this NodeList as well as items passed in as parameters
.connect(methodName, objOrFunc, funcName) Attach event handlers to every item of the NodeList.
.coords() Deprecated: Use position() for border-box x/y/w/h or marginBox() for margin-box w/h/l/t.
.data(key, value) stash or get some arbitrary data on/from these nodes.
.delegate(selector, eventName, fn) Monitor nodes in this NodeList for [bubbled] events on nodes that match selector. Calls fn(evt) for those events, where (inside of fn()), this == the node that matches the selector.
.dtl(template, context) Renders the specified template in each of the NodeList entries.
.empty() clears all content from each node in the list.
.end() Ends use of the current NodeList by returning the previous NodeList that generated the current NodeList.
.even() Returns the even nodes in this dojo/NodeList as a dojo/NodeList.
.every(callback, thisObject) see dojo.every() and the Array.every docs.
.fadeIn(args) fade in all elements of this NodeList via dojo.fadeIn
.fadeOut(args) fade out all elements of this NodeList via dojo.fadeOut
.filter(filter) "masks" the built-in javascript filter() method (supported in Dojo via dojo.filter) to support passing a simple string filter in addition to supporting filtering function objects.
.first() Returns the first node in this dojo/NodeList as a dojo/NodeList.
.forEach(callback, thisObj) see dojo.forEach().
.html(value) allows setting the innerHTML of each node in the NodeList, if there is a value passed in, otherwise, reads the innerHTML value of the first node.
.indexOf(value, fromIndex) see dojo.indexOf(). The primary difference is that the acted-on array is implicitly this NodeList
.innerHTML(value) allows setting the innerHTML of each node in the NodeList, if there is a value passed in, otherwise, reads the innerHTML value of the first node.
.insertAfter(query) The nodes in this NodeList will be placed after the nodes matched by the query passed to insertAfter.
.insertBefore(query) The nodes in this NodeList will be placed after the nodes matched by the query passed to insertAfter.
.instantiate(declaredClass, properties) Create a new instance of a specified class, using the specified properties and each node in the NodeList as a srcNodeRef.
.last() Returns the last node in this dojo/NodeList as a dojo/NodeList.
.lastIndexOf(value, fromIndex) see dojo.lastIndexOf(). The primary difference is that the acted-on array is implicitly this NodeList
.map(func, obj) see dojo.map().
.marginBox() Returns margin-box size of nodes
.next(query) Returns the next element for nodes in this dojo/NodeList. Optionally takes a query to filter the next elements.
.nextAll(query) Returns all sibling elements that come after the nodes in this dojo/NodeList. Optionally takes a query to filter the sibling elements.
.odd() Returns the odd nodes in this dojo/NodeList as a dojo/NodeList.
.on(eventName, listener) Listen for events on the nodes in the NodeList.
.orphan(filter) removes elements in this list that match the filter from their parents and returns them as a new NodeList.
.parent(query) Returns immediate parent elements for nodes in this dojo/NodeList. Optionally takes a query to filter the parent elements.
.parents(query) Returns all parent elements for nodes in this dojo/NodeList. Optionally takes a query to filter the child elements.
.place(queryOrNode, position) places elements of this node list relative to the first element matched by queryOrNode.
.position() Returns border-box objects (x/y/w/h) of all elements in a node list as an Array (not a NodeList).
.prepend(content) prepends the content to every node in the NodeList.
.prependTo(query) prepends nodes in this NodeList to the nodes matched by the query passed to prependTo.
.prev(query) Returns the previous element for nodes in this dojo/NodeList. Optionally takes a query to filter the previous elements.
.prevAll(query) Returns all sibling elements that come before the nodes in this dojo/NodeList. Optionally takes a query to filter the sibling elements.
.query(queryStr) Returns a new list whose members match the passed query, assuming elements of the current NodeList as the root for each search.
.remove(filter) removes elements in this list that match the filter from their parents and returns them as a new NodeList.
.removeAttr(name) Removes an attribute from each node in the list.
.removeClass(className) removes the specified class from every node in the list
.removeClassFx(cssClass, args) Animate the effect of removing a class to all nodes in this list. see dojox.fx.removeClass
.removeData(key) Remove the data associated with these nodes.
.replaceAll(query) replaces nodes matched by the query passed to replaceAll with the nodes in this NodeList.
.replaceClass(addClassStr, removeClassStr) Replaces one or more classes on a node if not present.
.replaceWith(content) Replaces each node in ths NodeList with the content passed to replaceWith.
.siblings(query) Returns all sibling elements for nodes in this dojo/NodeList. Optionally takes a query to filter the sibling elements.
.slice(begin, end) Returns a new NodeList, maintaining this one in place
.slideTo(args) slide all elements of the node list to the specified place via dojo/fx.slideTo()
.some(callback, thisObject) Takes the same structure of arguments and returns as dojo.some() with the caveat that the passed array is implicitly this NodeList.
.splice(index, howmany, item) Returns a new NodeList, manipulating this NodeList based on the arguments passed, potentially splicing in new elements at an offset, optionally deleting elements
.style(property, value) gets or sets the CSS property for every element in the NodeList
.text(value) allows setting the text value of each node in the NodeList, if there is a value passed in, otherwise, returns the text value for all the nodes in the NodeList in one string.
.toggleClass(className, condition) Adds a class to node if not present, or removes if present.
.toggleClassFx(cssClass, force, args) Animate the effect of adding or removing a class to all nodes in this list. see dojox.fx.toggleClass
.toString()
.val(value) If a value is passed, allows seting the value property of form elements in this NodeList, or properly selecting/checking the right value for radio/checkbox/select elements.
.wipeIn(args) wipe in all elements of this NodeList via dojo/fx.wipeIn()
.wipeOut(args) wipe out all elements of this NodeList via dojo/fx.wipeOut()
.wrap(html) Wrap each node in the NodeList with html passed to wrap.
.wrapAll(html) Insert html where the first node in this NodeList lives, then place all nodes in this NodeList as the child of the html.
.wrapInner(html) For each node in the NodeList, wrap all its children with the passed in html..
*/

});
