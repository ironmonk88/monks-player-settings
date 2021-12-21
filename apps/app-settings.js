export const WithMonksSettings = (BaseSettings) => {
    class MonksSettings extends BaseSettings {
        constructor(...args) {
            super(...args);

            
        }
    }

    const constructorName = "MonksSettings";
    Object.defineProperty(MonksSettings.prototype.constructor, "name", { value: constructorName });
    return MonksSettings;
};