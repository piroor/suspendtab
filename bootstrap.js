/**
 * @fileOverview Bootstrap code for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      3
 *
 * @description
 *   This provides ability to load a script file placed to "modules/main.js".
 *   Functions named "shutdown", defined in main.js and any loaded script
 *   will be called when the addon is disabled or uninstalled (include
 *   updating).
 *
 * @license
 *   The MIT License, Copyright (c) 2010-2012 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

var _gLoader;
var _gResourceRegistered = false;

function _load(aScriptName, aId, aRoot, aReason)
{
	const IOService = Components.classes['@mozilla.org/network/io-service;1']
						.getService(Components.interfaces.nsIIOService);

	var resource, loader, script;
	if (aRoot.isDirectory()) {
		resource = IOService.newFileURI(aRoot);

		loader = aRoot.clone();
		loader.append('components');
		loader.append('loader.js');
		loader = IOService.newFileURI(loader).spec;

		script = aRoot.clone();
		script.append('modules');
		script.append(aScriptName+'.js');
		script = IOService.newFileURI(script).spec;
	}
	else {
		let base = 'jar:'+IOService.newFileURI(aRoot).spec+'!/';
		loader = base + 'components/loader.js';
		script = base + 'modules/'+aScriptName+'.js';
		resource = IOService.newURI(base, null, null);
	}

	if (!_gLoader) {
		_gLoader = {};
		Components.classes['@mozilla.org/moz/jssubscript-loader;1']
			.getService(Components.interfaces.mozIJSSubScriptLoader)
			.loadSubScript(loader, _gLoader);
	}

	if (!_gLoader.exists('modules/'+aScriptName+'.js', resource.spec))
		return;

	if (!_gResourceRegistered) {
		_gLoader.registerResource(aId.split('@')[0]+'-resources', resource);
		_gResourceRegistered = true;
	}
	_gLoader.load(script);
}

function _reasonToString(aReason)
{
	switch (aReason)
	{
		case APP_STARTUP: return 'APP_STARTUP';
		case APP_SHUTDOWN: return 'APP_SHUTDOWN';
		case ADDON_ENABLE: return 'ADDON_ENABLE';
		case ADDON_DISABLE: return 'ADDON_DISABLE';
		case ADDON_INSTALL: return 'ADDON_INSTALL';
		case ADDON_UNINSTALL: return 'ADDON_UNINSTALL';
		case ADDON_UPGRADE: return 'ADDON_UPGRADE';
		case ADDON_DOWNGRADE: return 'ADDON_DOWNGRADE';
	}
	return aReason;
}

function _free()
{
	_gLoader =
	_load =
	_reasonToString =
	_free = _gResourceRegistered =
	install =
	uninstall =
	startup =
	shoutdown =
		undefined;
}

/**
 * handlers for bootstrap
 */

function install(aData, aReason)
{
	_load('install', aData.id, aData.installPath, _reasonToString(aReason));
	_gLoader.install(_reasonToString(aReason));
}

function startup(aData, aReason)
{
	_load('main', aData.id, aData.installPath, _reasonToString(aReason));
}

function shutdown(aData, aReason)
{
	if (!_gLoader) return;
	if (_gResourceRegistered) {
		_gLoader.unregisterResource(aData.id.split('@')[0]+'-resources');
	}
	_gLoader.shutdown(_reasonToString(aReason));
	_free();
}

function uninstall(aData, aReason)
{
	if (!_gLoader) {
		_load('install', aData.id, aData.installPath, _reasonToString(aReason));
	}
	_gLoader.uninstall(_reasonToString(aReason));
	if (_gResourceRegistered) {
		_gLoader.unregisterResource(aData.id.split('@')[0]+'-resources');
	}
	_free();
}
