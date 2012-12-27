/**
 * @fileOverview Here-document module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      1
 * @description  Inspired from https://github.com/cho45/node-here.js
 *
 * @license
 *   The MIT License, Copyright (c) 2012 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

const EXPORTED_SYMBOLS = ['here'];

function here() {
	var caller = Components.stack.caller;
	var filename = caller.filename.split(' -> ').slice(-1)[0];
	var source = read(filename);
	var part = source.split(/\r?\n/).slice(caller.lineNumber).join('\n');
	part = part.replace(/.*\bhere\([^\/]*\/\*/, '');
	part = part.split('*/')[0];
	return part;
}
