/*jslint nomen: true */
/*jshint nomen: true */
/*global _, require, __dirname */
var util = require('util'),
    connect = require('connect'),
    port = 4000;

connect.createServer(connect['static'](__dirname + '/dist/www')).listen(port);
util.puts('Listening on ' + port + '...');
util.puts('Press Ctrl + C to stop.');

