/**
 * @fileOverview Here-document module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      3
 * @description  Inspired from https://github.com/cho45/node-here.js
 *
 * @license
 *   The MIT License, Copyright (c) 2012 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

var EXPORTED_SYMBOLS = ['here'];

var cache = {};

function here() {
	var caller = Components.stack.caller;
	var filename = caller.filename.split(' -> ').slice(-1)[0];
	var line = caller.lineNumber-1;
	var key = filename + ':' + line;
	if (key in cache) return cache[key];

	var source = read(filename);
	var part = source.split(/\r?\n/).slice(line).join('\n');
	part = part.replace(/.*\bhere\([^\/]*\/\*/, '');
	part = part.split('*/')[0];
	cache[key] = part;
	return part;
}

function shutdown() {
	cache = undefined;
}

if (typeof read == 'undefined') {
	var Cc = Components.classes;
	var Ci = Components.interfaces;
	var IOService = Cc['@mozilla.org/network/io-service;1'].getService(Ci.nsIIOService);

	read = function read(aURI) {
		var uri = IOService.newURI(aURI, null, null);
		var channel = IOService.newChannelFromURI(uri);
		var stream = channel.open();

		var fileContents = null;
		try {
			var scriptableStream = Cc['@mozilla.org/scriptableinputstream;1']
					.createInstance(Ci.nsIScriptableInputStream);
			scriptableStream.init(stream);
			fileContents = scriptableStream.read(scriptableStream.available());
			scriptableStream.close();
		}
		finally {
			stream.close();
		}

		return fileContents;
	};
}
