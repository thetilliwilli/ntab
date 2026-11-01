/*
 * the registry of apps. an app is a module's default export:
 *   id           also the action type ({ type: <id>, name }), the key of its uploaded icon and the view name;
 *                its screen is the element #app-<id>
 *   name         default action name and the page title while it is open
 *   what         what it is, in a few words (the sidebar flyout shows it instead of a URL)
 *   icon         svg markup of the built-in icon
 *   needsFolder  keeps data in the data folder: the shell opens the folder (or shows the gate) first
 *   init(ctx)    once per page: wire its DOM; ctx = { changeFolder() }
 *   start(opts)  each time the data folder is (re)opened: load data; opts.fresh = another folder was picked
 *   show()       each time its screen comes to the front
 *   flush()      optional: write pending changes (before the folder changes)
 */

import notes from "../apps/notes/index.js";
import tracker from "../apps/tracker/index.js";
import board from "../apps/board/index.js";

export const apps = [notes, tracker, board];
export const appById = (id) => apps.find((a) => a.id === id);
