var util = require('util'),
    connect = require('connect'),
    port = 8080;

connect.createServer(connect.static(__dirname + '/src')).listen(port);
util.puts('Listening on ' + port + '...');
util.puts('Press Ctrl + C to stop.');

