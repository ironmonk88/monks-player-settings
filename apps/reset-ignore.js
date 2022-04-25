export class ResetIgnore extends FormApplication {
    constructor(object, options) {
        super(object, options);
    }

    static get defaultOptions() {
        const options = super.defaultOptions;
        options.title = '';
        options.id = 'player-settings-resetignore';
        options.template = 'modules/monks-player-settings/templates/resetignore.html';
        options.closeOnSubmit = true;
        options.popOut = true;
        options.width = 1;
        options.height = 1;
        return options;
    }

    static async resetIgnore(app) {
        await game.user.unsetFlag("monks-player-settings", "ignore-id");
        app.close({ force: true });

        window.location.reload();
    }
}

Hooks.on("renderResetIgnore", ResetIgnore.resetIgnore);