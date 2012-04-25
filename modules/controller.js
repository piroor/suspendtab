/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Suspend Tab.
 *
 * The Initial Developer of the Original Code is SHIMODA Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):: SHIMODA Hiroshi <piro.outsider.reflex@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = ['SuspendTabController'];

load('lib/ToolbarItem');

var bundle = require('lib/locale')
				.get(resolve('locale/label.properties'));

var suspend = require('suspend');

function SuspendTabController(aWindow)
{
	this.init(aWindow);
}
SuspendTabController.prototype = {
	handleEvent : function(aEvent)
	{
		switch (aEvent.type)
		{
			case 'command': return this.onCommand(aEvent);
			case 'unload': return this.uninit(aEvent.relatedTarget);
		}
	},

	onCommand : function(aEvent)
	{
		var tab = aEvent.target.ownerDocument.defaultView.gBrowser.selectedTab;
		if (suspend.isSuspended(tab))
			suspend.resume(tab);
		else
			suspend.suspend(tab);
	},

	init : function(aWindow)
	{
		this.window = aWindow;
		this.window.addEventListener('unload', this, false);

		var toolbar = this.window.document.getElementById('nav-bar');
		this.toolbarButton = ToolbarItem.create(
			<>
				<toolbarbutton id="suspend-resume-button"
					tooltiptext={bundle.getString('button.label')}>
					<label value={bundle.getString('button.label')}/>
				</toolbarbutton>
			</>,
			toolbar,
			{
				onInit : function() {
				},
				onDestroy : function() {
				}
			}
		);
		this.toolbarButton.addEventListener('command', this, false);
	},

	destroy : function()
	{
		this.window.removeEventListener('unload', this, false);
		this.toolbarButton.removeEventListener('command', this, false);
		this.toolbarButton.destroy();
		delete this.toolbarButton;
		delete this.window;
	}
};

function shutdown()
{
	ToolbarItem = undefined;
	SuspendTabController = undefined;
	bundle = undefined;
	suspend = undefined;
}
