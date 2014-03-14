/**
 * @fileOverview Loader module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      10
 *
 * @license
 *   The MIT License, Copyright (c) 2010-2014 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

/** You can customize shared properties for loaded scripts. */
var Application = (function() {
	if ('@mozilla.org/fuel/application;1' in Components.classes)
		return Components.classes['@mozilla.org/fuel/application;1']
				.getService(Components.interfaces.fuelIApplication);
	if ('@mozilla.org/steel/application;1' in Components.classes)
		return Components.classes['@mozilla.org/steel/application;1']
				.getService(Components.interfaces.steelIApplication);
	return null;
})();
// import base64 utilities from the js code module namespace
try {
	var { atob, btoa } = Components.utils.import('resource://gre/modules/Services.jsm', {});
} catch(e) {
	Components.utils.reportError(new Error('failed to load Services.jsm'));
}
try {
	var { console } = Components.utils.import('resource://gre/modules/devtools/Console.jsm', {});
} catch(e) {
	Components.utils.reportError(new Error('failed to load Console.jsm'));
}
var _namespacePrototype = {
		Cc : Components.classes,
		Ci : Components.interfaces,
		Cu : Components.utils,
		Cr : Components.results,
		Application : Application,
		console : this.console,
		btoa    : function(aInput) {
			return btoa(aInput);
		},
		atob    : function(aInput) {
			return atob(aInput);
		}
	};
var _namespaces;

/**
 * This functiom loads specified script into a unique namespace for the URL.
 * Namespaces for loaded scripts have a wrapped version of this function.
 * Both this and wrapped work like as Components.utils.import().
 * Due to the reserved symbol "import", we have to use another name "load"
 * instead it.
 *
 * @param {String} aScriptURL
 *   URL of a script. Wrapped version of load() can handle related path.

 *   Related path will be resolved based on the location of the caller script.
 * @param {Object=} aExportTargetForImport
 *   EXPORTED_SYMBOLS in the loaded script will be exported to the object.
 *   If no object is specified, symbols will be exported to the global object
 *   of the caller.
 * @param {Object=} aExportTargetForRequire
 *   Properties of "exports" in the loaded script will be exported to the object.
 *
 * @returns {Object}
 *   The global object for the loaded script.
 */
function load(aURISpec, aExportTargetForImport, aExportTargetForRequire, aRoot)
{
	if (!_namespaces)
		_namespaces = {};
	var ns;
	if (aURISpec in _namespaces) {
		ns = _namespaces[aURISpec];
		_exportForImport(ns, aExportTargetForImport);
		_exportForRequire(ns, aExportTargetForRequire);
		return ns;
	}
	ns = _createNamespace(aURISpec, aRoot || aURISpec);
	try {
		Components.classes['@mozilla.org/moz/jssubscript-loader;1']
			.getService(Components.interfaces.mozIJSSubScriptLoader)
			.loadSubScript(aURISpec, ns);
	}
	catch(e) {
		let message = 'Loader::load('+aURISpec+') failed!\n'+e+'\n';
		dump(message);
		Components.utils.reportError(message + e.stack);
		throw e;
	}
	_exportForImport(ns, aExportTargetForImport);
	_exportForRequire(ns, aExportTargetForRequire);
	return _namespaces[aURISpec] = ns;
}

// JavaScript code module style
function _exportForImport(aSource, aTarget)
{
	if (
		!aTarget ||
		!('EXPORTED_SYMBOLS' in aSource) ||
		!aSource.EXPORTED_SYMBOLS ||
		!aSource.EXPORTED_SYMBOLS.forEach
		)
		return;
	for each (var symbol in aSource.EXPORTED_SYMBOLS)
	{
		aTarget[symbol] = aSource[symbol];
	}
}

// CommonJS style
function _exportForRequire(aSource, aTarget)
{
	if (
		!aTarget ||
		!('exports' in aSource) ||
		!aSource.exports ||
		typeof aSource.exports != 'object'
		)
		return;
	for (var symbol in aSource.exports)
	{
		aTarget[symbol] = aSource.exports[symbol];
	}
}

var IOService = Components.classes['@mozilla.org/network/io-service;1']
					.getService(Components.interfaces.nsIIOService);
var FileHandler = IOService.getProtocolHandler('file')
					.QueryInterface(Components.interfaces.nsIFileProtocolHandler);

/**
 * Checks existence of the file specified by the given relative path and the base URI.
 *
 * @param {String} aPath
 *   A relative path to a file or directory, from the aBaseURI.
 * @param {String} aBaseURI
 *   An absolute URI (with scheme) for relative paths.
 *
 * @returns {String}
 *   If the file (or directory) exists, returns the absolute URI. Otherwise null.
 */
function exists(aPath, aBaseURI)
{
	if (/^\w+:/.test(aPath)) {
		let leafName = aPath.match(/([^\/]+)$/);
		leafName = leafName ? leafName[1] : '' ;
		aBaseURI = aPath.replace(/(?:[^\/]+)$/, '');
		aPath = leafName;
	}
	var baseURI = aBaseURI.indexOf('file:') == 0 ?
					IOService.newFileURI(FileHandler.getFileFromURLSpec(aBaseURI)) :
					IOService.newURI(aBaseURI, null, null);
	if (aBaseURI.indexOf('jar:') == 0) {
		baseURI = baseURI.QueryInterface(Components.interfaces.nsIJARURI);
		var reader = Components.classes['@mozilla.org/libjar/zip-reader;1']
						.createInstance(Components.interfaces.nsIZipReader);
		reader.open(baseURI.JARFile.QueryInterface(Components.interfaces.nsIFileURL).file);
	    try {
			let baseEntry = baseURI.JAREntry.replace(/[^\/]+$/, '');
			let entries = reader.findEntries(baseEntry + aPath + '$');
			let found = entries.hasMore();
			return found ? baseURI.resolve(aPath) : null ;
		}
		finally {
			reader.close();
		}
	}
	else {
		let resolved = baseURI.resolve(aPath);
		return FileHandler.getFileFromURLSpec(resolved).exists() ? resolved : null ;
	}
}

function doAndWait(aAsyncTask)
{
	const Cc = Components.classes;
	const Ci = Components.interfaces;

	var done = false;
	var returnedValue = void(0);
	var continuation = function(aReturnedValue) {
			done = true;
			returnedValue = aReturnedValue;
		};

	var timer = Cc['@mozilla.org/timer;1']
					.createInstance(Ci.nsITimer);
	timer.init(function() {
		aAsyncTask(continuation);
	}, 0, Ci.nsITimer.TYPE_ONE_SHOT);

	var thread = Cc['@mozilla.org/thread-manager;1']
					.getService(Ci.nsIThreadManager)
					.currentThread;
	while (!done) {
		thread.processNextEvent(true);
	}
	return returnedValue;
}

function _readFrom(aURISpec, aEncoding)
{
	const Cc = Components.classes;
	const Ci = Components.interfaces;

	var uri = aURISpec.indexOf('file:') == 0 ?
			IOService.newFileURI(FileHandler.getFileFromURLSpec(aURISpec)) :
			IOService.newURI(aURISpec, null, null) ;
	var channel = IOService.newChannelFromURI(uri.QueryInterface(Ci.nsIURI));
	var stream = channel.open();

	var fileContents = null;
	try {
		if (aEncoding) {
			var converterStream = Cc['@mozilla.org/intl/converter-input-stream;1']
					.createInstance(Ci.nsIConverterInputStream);
			var buffer = stream.available();
			converterStream.init(stream, aEncoding, buffer,
				converterStream.DEFAULT_REPLACEMENT_CHARACTER);
			var out = { value : null };
			converterStream.readString(stream.available(), out);
			converterStream.close();
			fileContents = out.value;
		}
		else {
			var scriptableStream = Cc['@mozilla.org/scriptableinputstream;1']
					.createInstance(Ci.nsIScriptableInputStream);
			scriptableStream.init(stream);
			fileContents = scriptableStream.read(scriptableStream.available());
			scriptableStream.close();
		}
	}
	finally {
		stream.close();
	}
	return fileContents;
}

function _createNamespace(aURISpec, aRoot)
{
	var baseURI = aURISpec.indexOf('file:') == 0 ?
					IOService.newFileURI(FileHandler.getFileFromURLSpec(aURISpec)) :
					IOService.newURI(aURISpec, null, null);
	var rootURI = typeof aRoot == 'string' ?
					(aRoot.indexOf('file:') == 0 ?
						IOService.newFileURI(FileHandler.getFileFromURLSpec(aRoot)) :
						IOService.newURI(aRoot, null, null)
					) :
					aRoot ;
	var ns = {
			__proto__ : _namespacePrototype,
			location : _createFakeLocation(baseURI),
			exists : function(aPath, aBase) {
				return exists(aPath, aBase || baseURI.spec);
			}, 
			exist : function(aPath, aBase) { // alias
				return exists(aPath, aBase || baseURI.spec);
			}, 
			/** JavaScript code module style */
			load : function(aURISpec, aExportTarget) {
				if (!/\.jsm?$/.test(aURISpec)) {
					if (exists(aURISpec+'.js', baseURI.spec))
						aURISpec += '.js'
					else if (exists(aURISpec+'.jsm', baseURI.spec))
						aURISpec += '.jsm'
				}
				var resolved = baseURI.resolve(aURISpec);
				if (resolved == aURISpec)
					throw new Error('Recursive load!');
				return load(resolved, aExportTarget || ns, aExportTarget, rootURI);
			},
			'import' : function() { // alias
				return this.load.apply(this, arguments);
			},
			/**
			 * CommonJS style
			 * @url http://www.commonjs.org/specs/
			 */
			require : function(aURISpec) {
				if (!/\.jsm?$/.test(aURISpec)) {
					if (exists(aURISpec+'.js', baseURI.spec))
						aURISpec += '.js'
					else if (exists(aURISpec+'.jsm', baseURI.spec))
						aURISpec += '.jsm'
				}
				var resolved = (aURISpec.charAt(0) == '.' ? rootURI : baseURI ).resolve(aURISpec);
				if (resolved == aURISpec)
					throw new Error('Recursive load!');
				var exported = {};
				load(resolved, exported, exported, rootURI);
				return exported;
			},
			/* utility to resolve relative path from the file */
			resolve : function(aURISpec, aBaseURI) {
				var base = !aBaseURI ?
								baseURI :
							aBaseURI.indexOf('file:') == 0 ?
								IOService.newFileURI(FileHandler.getFileFromURLSpec(aURISpec)) :
								IOService.newURI(aURISpec, null, null) ;
				return base.resolve(aURISpec);
			},
			/* utility to read contents of a text file */
			read : function(aURISpec, aEncoding, aBaseURI) {
				return _readFrom(this.resolve(aURISpec, aBaseURI), aEncoding);
			},
			doAndWait : function(aAsyncTask) {
				return doAndWait(aAsyncTask);
			},
			exports : {}
		};
	return ns;
}

function _createFakeLocation(aURI)
{
	aURI = aURI.QueryInterface(Components.interfaces.nsIURL)
					.QueryInterface(Components.interfaces.nsIURI);
	return {
		href     : aURI.spec,
		search   : aURI.query ? '?'+aURI.query : '' ,
		hash     : aURI.ref ? '#'+aURI.ref : '' ,
		host     : aURI.scheme == 'jar' ? '' : aURI.hostPort,
		hostname : aURI.scheme == 'jar' ? '' : aURI.host,
		port     : aURI.scheme == 'jar' ? -1 : aURI.port,
		pathname : aURI.path,
		protocol : aURI.scheme+':',
		reload   : function() {},
		replace  : function() {},
		toString : function() {
			return this.href;
		}
	};
}

function _callHandler(aHandler, aReason)
{
	for (var i in _namespaces)
	{
		try {
			if (_namespaces[i][aHandler] &&
				typeof _namespaces[i][aHandler] == 'function')
				_namespaces[i][aHandler](aReason);
		}
		catch(e) {
			let message = i+'('+aHandler+', '+aReason+')\n'+e+'\n';
			dump(message);
			Components.utils.reportError(message + e.stack);
		}
	}
}

function registerResource(aName, aRoot)
{
	IOService.getProtocolHandler('resource')
		.QueryInterface(Components.interfaces.nsIResProtocolHandler)
		.setSubstitution(aName, aRoot);
}

function unregisterResource(aName)
{
	IOService.getProtocolHandler('resource')
		.QueryInterface(Components.interfaces.nsIResProtocolHandler)
		.setSubstitution(aName, null);
}

/** Handler for "install" of the bootstrap.js */
function install(aReason)
{
	_callHandler('install', aReason);
}

/** Handler for "uninstall" of the bootstrap.js */
function uninstall(aReason)
{
	_callHandler('uninstall', aReason);
}

/** Handler for "shutdown" of the bootstrap.js */
function shutdown(aReason)
{
	_callHandler('shutdown', aReason);

	for each (let ns in _namespaces)
	{
		for (let i in ns.exports)
		{
			if (ns.exports.hasOwnProperty(i))
				delete ns.exports[i];
		}
	}
	_namespaces = void(0);
	_namespacePrototype = void(0);
	Application = void(0);

	IOService = void(0);
	FileHandler = void(0);

	load = void(0);
	_exportSymbols = void(0);
	exists = void(0);
	_createNamespace = void(0);
	_callHandler = void(0);
	registerResource = void(0);
	unregisterResource = void(0);
	install = void(0);
	uninstall = void(0);
	shutdown = void(0);
}
