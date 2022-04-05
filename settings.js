import { MonksPlayerSettings, i18n } from "./monks-player-settings.js";

export const registerSettings = function () {
    // Register any custom module settings here
    let modulename = "monks-player-settings";
	
	game.settings.register(modulename, "sync-settings", {
		name: i18n("MonksPlayerSettings.sync-settings.name"),
		hint: i18n("MonksPlayerSettings.sync-settings.hint"),
		config: true,
		scope: "client",
		default: true,
		type: Boolean
	});
};
