/**
 * @fileOverview Locale module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      7
 *
 * @license
 *   The MIT License, Copyright (c) 2010-2013 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

var EXPORTED_SYMBOLS = ['locale'];

var DEFAULT_LOCALE = 'en-US';

var gCache = {}
var get = function(aPath, aBaseURI) {
		if (/^\w+:/.test(aPath))
			aBaseURI = aPath;

		var uri = aPath;
		if (!/^chrome:\/\/[^\/]+\/locale\//.test(uri)) {
			let locale = DEFAULT_LOCALE;
			try {
				let prefs = Cc['@mozilla.org/preferences;1'].getService(Ci.nsIPrefBranch);
				locale = prefs.getCharPref('general.useragent.locale');
				if (/\w+:/.test(locale))
					locale = prefs.getComplexValue('general.useragent.locale', Ci.nsIPrefLocalizedString).data;
				locale = locale || DEFAULT_LOCALE;
			}
			catch(e) {
				dump(e+'\n');
			}
			[
				aPath+'.'+locale,
				aPath+'.'+(locale.split('-')[0]),
				aPath+'.'+DEFAULT_LOCALE,
				aPath+'.'+(DEFAULT_LOCALE.split('-')[0])
			].some(function(aURI) {
				let resolved = exists(aURI, aBaseURI);
				if (resolved) {
					uri = resolved;
					return true;
				}
				return false;
			});
		}

		if (!(uri in gCache)) {
			gCache[uri] = new StringBundle(uri);
		}
		return gCache[uri];
	};
exports.get = get;

var locale = { 'get' : get };

const Service = Cc['@mozilla.org/intl/stringbundle;1']
					.getService(Ci.nsIStringBundleService);

function StringBundle(aURI) 
{
	this._bundle = Service.createBundle(aURI);
}
StringBundle.prototype = {
	getString : function(aKey) {
		try {
			return this._bundle.GetStringFromName(aKey);
		}
		catch(e) {
			Cu.reportError(new Error('locale.js: failed to call GetStringFromName() with: ' + aKey + '\n' + e));
		}
		return '';
	},
	getFormattedString : function(aKey, aArray) {
		try {
			return this._bundle.formatStringFromName(aKey, aArray, aArray.length);
		}
		catch(e) {
			Cu.reportError(new Error('locale.js: failed to call formatStringFromName() with: ' + JSON.stringify({ key: aKey, args: aArray }) + '\n' + e));
			Cu.reportError(e);
		}
		return '';
	},
	get strings() {
		return this._bundle.getSimpleEnumeration();
	}
};

/** A handler for bootstrap.js */
function shutdown()
{
	gCache = {};
	Service.flushBundles();
}
