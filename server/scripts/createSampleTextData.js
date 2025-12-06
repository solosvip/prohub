const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.sqlite');

const db = new Database(DB_FILE);

// 创建一些示例文本内容
const createSampleTextData = () => {
  console.log('创建示例文本数据...');

  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO items (title, content, content_type, folder_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertItemTag = db.prepare(`
    INSERT OR IGNORE INTO item_tags (item_id, tag_id)
    VALUES (?, ?)
  `);

  const now = new Date().toISOString();

  // 获取文件夹和标签
  const textFolder = db.prepare('SELECT id FROM folders WHERE name = ?').get('文本Prompt');
  const aiTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('AI绘画');
  const creativeTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('创意');
  const businessTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('商业');

  // 创建示例文本内容
  const sampleTexts = [
    {
      title: 'AI绘画助手',
      content: '你是一个专业的AI绘画助手，擅长创作各种风格的艺术作品。请根据用户的需求生成详细的绘画描述，包括风格、色彩、构图等要素。你可以帮助用户：\n\n1. 生成详细的绘画描述词\n2. 提供专业的艺术建议\n3. 优化和改进现有的描述词\n4. 推荐合适的艺术风格\n\n请始终保持专业和友好的态度。',
      tags: [aiTag?.id]
    },
    {
      title: '商业文案生成器',
      content: '作为一名资深的商业文案专家，你需要根据产品特点和目标受众，创作具有说服力和吸引力的商业文案。你的文案应该：\n\n• 突出产品的核心优势\n• 准确把握目标用户需求\n• 使用有说服力的语言\n• 符合品牌调性\n• 具备良好的可读性\n\n请确保每一篇文案都经过深思熟虑，能够真正帮助客户提升品牌价值和销售转化率。',
      tags: [businessTag?.id]
    },
    {
      title: '创意故事写作',
      content: '你是一个充满想象力的故事创作专家，擅长各种类型的故事写作。无论是童话、科幻、悬疑还是现实主义，你都能创作出引人入胜的故事情节。\n\n你的创作特点：\n1. 丰富的想象力\n2. 流畅的叙事节奏\n3. 鲜明的人物塑造\n4. 巧妙的情节安排\n5. 深刻的主题思考\n\n请根据用户的需求，创作出独特而精彩的故事内容。',
      tags: [creativeTag?.id]
    },
    {
      title: '技术文档助手',
      content: '你是一个专业的技术文档写作专家，能够将复杂的技术概念转化为清晰易懂的文档内容。你的专长包括：\n\n• API文档编写\n• 用户手册制作\n• 技术教程撰写\n• 开发者指南\n• 系统架构说明\n\n你总是能够用准确的语言和合适的结构，让技术内容变得易于理解和操作。',
      tags: []
    },
    {
      title: '营销策略顾问',
      content: '作为一名经验丰富的营销策略顾问，你能够为企业提供全方位的营销建议和解决方案。你的专业领域包括：\n\n🎯 市场分析与定位\n📊 竞争对手研究\n💡 创意营销策略\n📱 社交媒体运营\n📈 数据分析与优化\n\n你总是能够基于市场数据和消费者洞察，为客户制定切实可行的营销方案。',
      tags: [businessTag?.id, creativeTag?.id]
    }
  ];

  // 插入文本数据
  sampleTexts.forEach((text, index) => {
    const result = insertItem.run(
      text.title,
      text.content,
      'text',
      textFolder?.id || 1,
      now,
      now
    );

    // 添加标签关联
    if (result.lastInsertRowid) {
      text.tags.forEach(tagId => {
        if (tagId) {
          insertItemTag.run(result.lastInsertRowid, tagId);
        }
      });
    }

    console.log(`✅ 创建文本内容: ${text.title}`);
  });

  console.log('✅ 示例文本数据创建完成');
};

// 执行数据创建
try {
  createSampleTextData();
  console.log('🎉 测试数据创建成功！');
} catch (error) {
  console.error('❌ 创建测试数据失败:', error);
} finally {
  db.close();
}