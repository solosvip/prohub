const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.sqlite');

const db = new Database(DB_FILE);

function cleanupAndNormalizeFolders() {
  console.log('🚀 开始数据库清理与规范化任务...');

  const baseNames = ['文本', '图片', '视频', '未归类'];
  const folderGroups = {};

  // 1. 智能识别与分组
  console.log('\n--- 步骤 1: 智能识别与分组所有顶级文件夹 ---');
  const topLevelFolders = db.prepare('SELECT * FROM folders WHERE parent_id IS NULL').all();

  for (const folder of topLevelFolders) {
    let baseName = null;
    for (const name of baseNames) {
      if (folder.name.startsWith(name)) {
        baseName = name;
        break;
      }
    }

    if (baseName) {
      if (!folderGroups[baseName]) {
        folderGroups[baseName] = [];
      }
      folderGroups[baseName].push(folder);
    } else {
      console.log(`  - 警告: 发现未知顶级文件夹 "${folder.name}" (ID: ${folder.id})，将不作处理。`);
    }
  }
  console.log('✅ 分组完成');

  // 2. 合并重复项并统一命名
  console.log('\n--- 步骤 2: 合并重复项并统一命名 ---');
  db.transaction(() => {
    for (const baseName in folderGroups) {
      const group = folderGroups[baseName];
      console.log(`\n🔍 正在处理 "${baseName}" 分组...`);

      if (group.length <= 1) {
        console.log(`  -> 无重复记录，仅确保名称正确。`);
        const canonicalRecord = group[0];
        if (canonicalRecord.name !== baseName) {
            const updateNameStmt = db.prepare('UPDATE folders SET name = ? WHERE id = ?');
            updateNameStmt.run(baseName, canonicalRecord.id);
            console.log(`  -> 名称已从 "${canonicalRecord.name}" 规范化为 "${baseName}"`);
        }
        continue;
      }

      // 对组内文件夹按ID排序，ID最小的作为主记录
      group.sort((a, b) => a.id - b.id);
      
      const canonicalRecord = group[0];
      const recordsToDelete = group.slice(1);
      const idsToDelete = recordsToDelete.map(r => r.id);

      console.log(`  -> 发现 ${group.length} 个记录。主记录 ID: ${canonicalRecord.id}`);
      console.log(`  -> 待删除的重复记录 ID: ${idsToDelete.join(', ')}`);

      // 确保主记录名称是正确的
      if (canonicalRecord.name !== baseName) {
        const updateNameStmt = db.prepare('UPDATE folders SET name = ? WHERE id = ?');
        updateNameStmt.run(baseName, canonicalRecord.id);
        console.log(`  -> 主记录名称已从 "${canonicalRecord.name}" 规范化为 "${baseName}"`);
      }

      // 迁移子文件夹
      const updateSubfoldersStmt = db.prepare(
        `UPDATE folders SET parent_id = ? WHERE parent_id IN (${idsToDelete.map(() => '?').join(',')})`
      );
      const subfolderChanges = updateSubfoldersStmt.run(canonicalRecord.id, ...idsToDelete);
      console.log(`  -> ${subfolderChanges.changes} 个子文件夹已成功迁移。`);

      // 迁移内容项
      const updateItemsStmt = db.prepare(
        `UPDATE items SET folder_id = ? WHERE folder_id IN (${idsToDelete.map(() => '?').join(',')})`
      );
      const itemChanges = updateItemsStmt.run(canonicalRecord.id, ...idsToDelete);
      console.log(`  -> ${itemChanges.changes} 个内容项已成功迁移。`);

      // 删除重复记录
      const deleteStmt = db.prepare(
        `DELETE FROM folders WHERE id IN (${idsToDelete.map(() => '?').join(',')})`
      );
      const deleteChanges = deleteStmt.run(...idsToDelete);
      console.log(`  -> ${deleteChanges.changes} 个重复记录已删除。`);
    }
  })();

  console.log('\n✅ 数据库清理与规范化任务完成！');
}

try {
  cleanupAndNormalizeFolders();
  db.close();
} catch (error) {
  console.error('❌ 清理过程中发生错误:', error);
  db.close();
  process.exit(1);
}
