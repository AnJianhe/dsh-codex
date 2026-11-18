/**
 * 运行时模型清单账本。
 *
 * 选择器本该服务「agent 实际提供的模型」，而不是操作员事先配的清单——后者在第一次
 * 对话之前就写死了。运行时（各家的 `session/new` 回复）读到的清单记在这里；目录
 * 适配器一旦有这份记录，就优先用它，没有再退回配置的那份。
 */
/** 一份内存账本，供运行时上报与目录适配器共用。 */
export function runtimeModels() {
    const byPreset = new Map();
    return {
        record: (presetId, models) => {
            // 只留 agent 真能服务的：模型拿 wire id 自报，其余的会渲染成坏掉的选择器行。
            byPreset.set(presetId, models.filter(model => typeof model?.id === 'string'));
        },
        modelsOf: presetId => byPreset.get(presetId),
    };
}
