/**
 * AI 搜索（OpenAI 兼容接口）
 *
 * 检索逻辑在主进程（src/main/ai.js）：
 *   1. 建立向量索引时，用视觉模型为每张图片生成描述，再用向量模型
 *      把描述转为向量，存入根目录缓存库 cache.db 的 ai_embeddings 表。
 *   2. 搜索时把自然语言 query 用向量模型转成向量，与索引做余弦相似度，
 *      返回 Top-K 图片（结构与 images:list 一致，可直接喂给瀑布流）。
 *
 * 调用方：App.vue 的 runAiSearch()（工具栏 AI 搜索开关开启后回车触发）
 */
export async function aiSearch(rootId, query) {
  return window.api.aiSearch(rootId, query)
}
