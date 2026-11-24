import type { LifeOSBackupPayload } from '../types/models';
import { db } from './database';

/**
 * 导出全部 7 张 IndexedDB 表为标准 JSON 备份对象
 * 默认脱敏剥离个人 API Key（aiApiKey / amapWebKey），避免用户分享备份文件时意外泄露密钥
 */
export async function exportDatabaseBackup(includeApiKeys = false): Promise<LifeOSBackupPayload> {
  const [userProfile, foodItems, mealLogs, workoutPlans, workoutLogs, habitLogs, rawSettings] =
    await Promise.all([
      db.userProfile.toArray(),
      db.foodItems.toArray(),
      db.mealLogs.toArray(),
      db.workoutPlans.toArray(),
      db.workoutLogs.toArray(),
      db.habitLogs.toArray(),
      db.settings.toArray(),
    ]);

  const settings = includeApiKeys
    ? rawSettings
    : rawSettings.map((s) => ({
        ...s,
        aiApiKey: '',
        amapWebKey: '',
      }));

  return {
    app: 'LifeOS',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      userProfile,
      foodItems,
      mealLogs,
      workoutPlans,
      workoutLogs,
      habitLogs,
      settings,
    },
  };
}

/** 触发浏览器下载本地 JSON 备份文件（默认脱敏不含个人 Key） */
export async function downloadBackupJson(includeApiKeys = false): Promise<string> {
  const payload = await exportDatabaseBackup(includeApiKeys);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `lifeos-backup-${dateStamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return fileName;
}

/**
 * 校验并原子事务导入 JSON 备份（若导入的脱敏备份中 Key 为空，自动保留本机已配置好的 Key）
 */
export async function importBackupJsonText(jsonText: string): Promise<{
  tablesRestored: number;
  totalRecords: number;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('JSON 文件格式错误，无法解析');
  }

  const payload = parsed as Partial<LifeOSBackupPayload>;
  if (payload?.app !== 'LifeOS' || !payload.data || typeof payload.data !== 'object') {
    throw new Error('不是有效的 LifeOS 备份文件');
  }

  const d = payload.data;
  const tables = [
    db.userProfile,
    db.foodItems,
    db.mealLogs,
    db.workoutPlans,
    db.workoutLogs,
    db.habitLogs,
    db.settings,
  ];

  let totalRecords = 0;

  await db.transaction('rw', tables, async () => {
    const prevSettings = await db.settings.get('app_settings');
    await Promise.all(tables.map((t) => t.clear()));

    if (Array.isArray(d.userProfile) && d.userProfile.length > 0) {
      await db.userProfile.bulkPut(d.userProfile);
      totalRecords += d.userProfile.length;
    }
    if (Array.isArray(d.foodItems) && d.foodItems.length > 0) {
      await db.foodItems.bulkPut(d.foodItems);
      totalRecords += d.foodItems.length;
    }
    if (Array.isArray(d.mealLogs) && d.mealLogs.length > 0) {
      await db.mealLogs.bulkPut(d.mealLogs);
      totalRecords += d.mealLogs.length;
    }
    if (Array.isArray(d.workoutPlans) && d.workoutPlans.length > 0) {
      await db.workoutPlans.bulkPut(d.workoutPlans);
      totalRecords += d.workoutPlans.length;
    }
    if (Array.isArray(d.workoutLogs) && d.workoutLogs.length > 0) {
      await db.workoutLogs.bulkPut(d.workoutLogs);
      totalRecords += d.workoutLogs.length;
    }
    if (Array.isArray(d.habitLogs) && d.habitLogs.length > 0) {
      await db.habitLogs.bulkPut(d.habitLogs);
      totalRecords += d.habitLogs.length;
    }
    if (Array.isArray(d.settings) && d.settings.length > 0) {
      const mergedSettings = d.settings.map((s) => ({
        ...s,
        aiApiKey: s.aiApiKey?.trim() ? s.aiApiKey : prevSettings?.aiApiKey || '',
        amapWebKey: s.amapWebKey?.trim() ? s.amapWebKey : prevSettings?.amapWebKey || '',
      }));
      await db.settings.bulkPut(mergedSettings);
      totalRecords += mergedSettings.length;
    }
  });

  return { tablesRestored: 7, totalRecords };
}
