/**
 * @fileOverview Window manager module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      5
 *
 * @license
 *   The MIT License, Copyright (c) 2010-2014 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

const EXPORTED_SYMBOLS = ['WindowManager'];

var _WindowWatcher = Cc['@mozilla.org/embedcomp/window-watcher;1']
						.getService(Ci.nsIWindowWatcher);
var _WindowMediator = Cc['@mozilla.org/appshell/window-mediator;1']
						.getService(Ci.nsIWindowMediator);

var _gListener = {
		observe : function(aSubject, aTopic, aData)
		{
			if (
				aTopic == 'domwindowopened' &&
				!aSubject
					.QueryInterface(Ci.nsIInterfaceRequestor)
					.getInterface(Ci.nsIWebNavigation)
					.QueryInterface(Ci.nsIDocShell)
					.QueryInterface(Ci.nsIDocShellTreeNode || Ci.nsIDocShellTreeItem) // nsIDocShellTreeNode is merged to nsIDocShellTreeItem by https://bugzilla.mozilla.org/show_bug.cgi?id=331376
					.QueryInterface(Ci.nsIDocShellTreeItem)
					.parent
				)
				aSubject
					.QueryInterface(Ci.nsIDOMWindow)
					.addEventListener('DOMContentLoaded', this, false);
		},
		handleEvent : function(aEvent)
		{
			aEvent.currentTarget.removeEventListener(aEvent.type, this, false);

			var window = aEvent.target.defaultView;
			this.listeners.forEach(function(aListener) {
				try {
					if (aListener.handleEvent &&
						typeof aListener.handleEvent == 'function')
						aListener.handleEvent(aEvent);
					if (aListener.handleWindow &&
						typeof aListener.handleWindow == 'function')
						aListener.handleWindow(window);
					if (typeof aListener == 'function')
						aListener(window);
				}
				catch(e) {
					dump(e+'\n');
				}
			});
		},
		listeners : []
	};
_WindowWatcher.registerNotification(_gListener);

/**
 * @class
 *   Provides features to get existing chrome windows, etc.
 */
var WindowManager = {
		/**
		 * Registers a handler for newly opened chrome windows. Handlers will
		 * be called when DOMContentLoaded events are fired in newly opened
		 * windows.
		 *
		 * @param {Object} aHandler
		 *   A handler for new windows. If you specify a function, it will be
		 *   called with the DOMWindow object as the first argument. If the
		 *   specified object has a method named "handleWindow", then the
		 *   method will be called with the DOMWindow. If the object has a
		 *   method named "handleEvent", then it will be called with the
		 *   DOMContentLoaded event object (not DOMWindow object.)
		 */
		addHandler : function(aListener)
		{
			if (!_gListener) return;
			if (
				aListener &&
				(
					typeof aListener == 'function' ||
					(aListener.handleWindow && typeof aListener.handleWindow == 'function') ||
					(aListener.handleEvent && typeof aListener.handleEvent == 'function')
				) &&
				_gListener.listeners.indexOf(aListener) < 0
				)
				_gListener.listeners.push(aListener);
		},
		/**
		 * Unregisters a handler.
		 */
		removeHandler : function(aListener)
		{
			if (!_gListener) return;
			let index = _gListener.listeners.indexOf(aListener);
			if (index > -1)
				_gListener.listeners.splice(index, 1);
		},
		/**
		 * Returns the most recent chrome window (DOMWindow).
		 *
		 * @param {string=} aWindowType
		 *   The window type you want to get, ex. "navigator:browser". If you
		 *   specify no type (null, blank string, etc.) then this returns
		 *   the most recent window of any type.
		 *
		 * @returns {nsIDOMWindow}
		 *   A found DOMWindow.
		 */
		getWindow : function(aType)
		{
			return _WindowMediator.getMostRecentWindow(aType || null);
		},
		/**
		 * Returns an array of chrome windows (DOMWindow).
		 *
		 * @param {string=} aWindowType
		 *   The window type you want to filter, ex. "navigator:browser". If
		 *   you  specify no type (null, blank string, etc.) then this returns
		 *   an array of all chrome windows.
		 *
		 * @returns {Array}
		 *   An array of found DOMWindows.
		 */
		getWindows : function(aType)
		{
			var array = [];
			var windows = _WindowMediator.getZOrderDOMWindowEnumerator(aType || null, true);

			// By the bug 156333, we cannot find windows by their Z order on Linux.
			// https://bugzilla.mozilla.org/show_bug.cgi?id=156333
			if (!windows.hasMoreElements())
				windows = _WindowMediator.getEnumerator(aType || null);

			while (windows.hasMoreElements())
			{
				array.push(windows.getNext().QueryInterface(Ci.nsIDOMWindow));
			}
			return array;
		}
	};
for (let i in WindowManager)
{
	exports[i] = (function(aSymbol) {
		return function() {
			return WindowManager[aSymbol].apply(WindowManager, arguments);
		};
	})(i);
}

/** A handler for bootstrap.js */
function shutdown()
{
	_WindowWatcher.unregisterNotification(_gListener);
	_WindowWatcher = void(0);
	_gListener.listeners = [];
}
