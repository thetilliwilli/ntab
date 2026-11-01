/*
 * the registry of apps. an app is a module's default export:
 *   id        its route ("#/<id>", what an "open" action points at) and the view name; its screen is #app-<id>
 *   name      default action name and the page title while it is open
 *   what      what it is, in a few words (the sidebar flyout and the actions editor show it)
 *   icon      svg markup of the built-in icon
 *   init()    once per page: wire its DOM
 *   start()   once per page, when it is first opened: load its data
 *   show()    each time its screen comes to the front
 *   flush()   optional: write pending changes now (before a backup is restored)
 */

import notes from "../apps/notes/index.js";
import tracker from "../apps/tracker/index.js";
import board from "../apps/board/index.js";

export const apps = [notes, tracker, board];
export const appById = (id) => apps.find((a) => a.id === id);
