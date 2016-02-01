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
 * The Initial Developer of the Original Code is YUKI "Piro" Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2012-2016
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):: YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
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

var exports = {
	domain : 'extensions.suspendtab@piro.sakura.ne.jp.',

	STATE : 'suspendtab-state',
	OPTIONS : 'suspendtab-options',
	READY : 'suspendtab-ready-to-resume',
	INDEX : 'suspendtab-current-index',
	SUSPENDED : 'suspendtab-suspended',
	MENUITEM_AVAILABLE : 'suspendtab-available',
	MENUITEM_ENABLED   : 'suspendtab-enabled',

	EVENT_TYPE_SUSPENDING : 'TabSuspending',
	EVENT_TYPE_SUSPENDED  : 'TabSuspended',
	EVENT_TYPE_RESUMING   : 'TabResuming',
	EVENT_TYPE_RESUMED    : 'TabResumed',
	EVENT_TYPE_TAB_LOADED : 'SuspendTabContentLoaded',

	NEXT_FOCUS_AUTO      : -1,
	NEXT_FOCUS_PRECEDING : 0,
	NEXT_FOCUS_FOLLOWING : 1,
	NEXT_FOCUS_FIRST     : 2,
	NEXT_FOCUS_LAST      : 3,
	NEXT_FOCUS_PREVIOUSLY_FOCUSED : 4
};
