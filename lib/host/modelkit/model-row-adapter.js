/**
 * 模型行的目录适配器。
 *
 * 一条模型行向宿主目录宣告：它是谁（providerInfo）、它有哪些模型（listModels）、
 * 某个 id 的元数据是什么（resolveModel）、以及一次请求怎么跑（stream/prepareCall）。
 * 这一支只做「模型」——请求由它自己应答，工具调用也一并交回原生循环。外部 ACP
 * 行的调度/网关/审批不在这里，那是各插件自己的事。
 */
import { collapsedToCatalog, collapseEffortModels } from "./efforts.js";
import { presetOfRoute } from "./provider-route.js";
/**
 * 造一个模型行适配器。
 * @param options - 见 {@link ModelRowAdapterOptions}。
 * @returns 宿主运行时消费的适配器。
 */
export function modelRowAdapter(options) {
    const deps = options;
    // 单一真相：一家一旦有运行时清单就用它，没有再用操作员配置的那份。
    // 解析与路由必须读同一份选择器宣告的清单，否则会一边宣告、一边按另一份路由。
    const modelsFor = (presetId) => deps.runtimeModelsOf?.(presetId) ?? deps.declaredModels;
    const adapter = {
        providerInfo: (provider) => ({ id: provider, name: deps.displayName }),
        listModels: async (provider) => {
            const presetId = presetOfRoute(provider);
            if (presetId === undefined)
                return [];
            // 先让这一行把清单备好（它自己登录、自己问上游），再回答。
            await deps.ensureModels?.(presetId);
            const models = modelsFor(presetId);
            const declaredEfforts = deps.efforts;
            // 折叠开关关上的行（id 不带强度后缀的那种）拿到一行一条；开着的把同 base 的
            // 强度并成一条，让选择器只显示模型一次、强度单独成轴。
            if (deps.collapseEfforts === false) {
                return models.map(model => collapsedToCatalog(provider, {
                    baseId: model.id,
                    displayName: model.name,
                    ...(model.description === undefined ? {} : { description: model.description }),
                    efforts: undefined,
                    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
                }, declaredEfforts));
            }
            return collapseEffortModels(models).map(model => collapsedToCatalog(provider, model, declaredEfforts));
        },
        // 运行时给每个宣告过的模型在构建时解析一次，也给会话里出现过的、从没进过目录的
        // id 解析一次。省掉这个方法，它名下的每条路由都会被整组当成目录失败、被选择器悄悄
        // 丢掉。未声明的 id 拿到的是运行时的默认答案（身份元数据），而不是抛错。
        resolveModel: async (provider, model) => {
            const presetId = presetOfRoute(provider);
            if (presetId === undefined)
                return { provider, id: model, name: model };
            // Resolve the exact same capabilities advertised by the picker, including
            // bare model IDs. Never silently drop reasoning or context metadata.
            const catalog = await adapter.listModels(provider);
            const found = catalog.find(candidate => candidate.id === model);
            return found ?? { provider, id: model, name: model };
        },
        // 原生循环每步都先过 llm.prepareCall() 才放行请求；运行时把这个无条件转给适配器。
        // 省掉它，会话里选了我们的模型、却还跑原生步的那一步会在进 stream 之前就 TypeError。
        prepareCall: async (provider, model) => ({
            model: await adapter.resolveModel(provider, model),
            stream: (options) => adapter.stream(options),
        }),
        // 模型行作为模型应答：请求就在这里跑，工具调用也一并回到问它的循环。宿主把一次
        // 完整生成请求交给这里——它需要工具、系统文本、输出上限，因为它就是模型。
        stream: function stream(options) {
            return (async function* modelRequest() {
                const presetId = presetOfRoute(options.provider);
                if (presetId === undefined) {
                    throw new Error(`model-kit: ${options.provider}/${options.model} 不是模型行路由，无法自行流式`);
                }
                if (deps.modelStream === undefined) {
                    throw new Error(`model-kit: ${options.provider}/${options.model} 没有配 modelStream，模型行无法应答`);
                }
                const direct = deps.modelStream(presetId, options);
                if (direct === undefined) {
                    throw new Error(`model-kit: ${options.provider}/${options.model} 的 modelStream 未应答这次请求`);
                }
                yield* direct;
            })();
        },
        // 运行时不检查它是否存在就要这个——省了它，整组路由一起遭殃。undefined 即「用
        // 正常默认值」。
        providerRetryPolicy: () => undefined,
        // 宿主统计会话 token 时对每条路由都要图像计价，也不检查方法存在——省了它，
        // TypeError 会在模型切换（上下文压缩）这一步把所有路由一起打下来
        // （2026-11-07 现场）。undefined 即「本路由不声明计价，用宿主的中性估算」。
        imageRequestPricing: () => undefined,
        // 请求带图时宿主同样无条件要图像投影；沿用宿主默认——原样交出。
        imageRequestTarget: (_provider, _model, image) => ({
            width: image.width,
            height: image.height,
            maxBytes: image.bytes,
        }),
    };
    return adapter;
}
