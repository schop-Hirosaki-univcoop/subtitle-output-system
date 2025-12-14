import { test } from 'node:test';
import assert from 'node:assert/strict';

// question-form/firebase.js は Firebase 依存があるため、getDatabaseInstance 関数のロジックを再現してテスト
// getDatabaseInstance のロジックを再現

// getDatabaseInstance のロジックを再現（簡略化版）
// 実際の実装では getApps(), getApp(), initializeApp(), getDatabase() を使用
// テストでは、これらの関数の動作を再現するモックを使用

function testGetDatabaseInstanceLogic(config, mockApps, mockGetApp, mockInitializeApp, mockGetDatabase) {
  // getApps() の結果をシミュレート
  const apps = mockApps || [];
  
  // apps.length が 0 より大きい場合は既存アプリを使用、そうでなければ新規初期化
  const app = apps.length > 0 ? mockGetApp() : mockInitializeApp(config);
  
  // getDatabase(app) を呼び出して Database インスタンスを返す
  return mockGetDatabase(app);
}

test('getDatabaseInstance uses existing app when apps are available', () => {
  const mockConfig = { apiKey: 'test-key' };
  const mockApps = [{ name: 'default' }]; // 既存アプリがある
  let getAppCalled = false;
  let initializeAppCalled = false;
  
  const mockGetApp = () => {
    getAppCalled = true;
    return { name: 'default' };
  };
  
  const mockInitializeApp = (config) => {
    initializeAppCalled = true;
    return { name: 'new-app' };
  };
  
  const mockGetDatabase = (app) => {
    return { app, type: 'database' };
  };
  
  const result = testGetDatabaseInstanceLogic(mockConfig, mockApps, mockGetApp, mockInitializeApp, mockGetDatabase);
  
  assert.equal(getAppCalled, true);
  assert.equal(initializeAppCalled, false);
  assert.equal(result.app.name, 'default');
  assert.equal(result.type, 'database');
});

test('getDatabaseInstance initializes new app when no apps are available', () => {
  const mockConfig = { apiKey: 'test-key' };
  const mockApps = []; // 既存アプリがない
  let getAppCalled = false;
  let initializeAppCalled = false;
  
  const mockGetApp = () => {
    getAppCalled = true;
    return { name: 'default' };
  };
  
  const mockInitializeApp = (config) => {
    initializeAppCalled = true;
    assert.equal(config.apiKey, 'test-key');
    return { name: 'new-app' };
  };
  
  const mockGetDatabase = (app) => {
    return { app, type: 'database' };
  };
  
  const result = testGetDatabaseInstanceLogic(mockConfig, mockApps, mockGetApp, mockInitializeApp, mockGetDatabase);
  
  assert.equal(getAppCalled, false);
  assert.equal(initializeAppCalled, true);
  assert.equal(result.app.name, 'new-app');
  assert.equal(result.type, 'database');
});

test('getDatabaseInstance passes config to initializeApp', () => {
  const mockConfig = { apiKey: 'custom-key', projectId: 'test-project' };
  const mockApps = [];
  let receivedConfig = null;
  
  const mockGetApp = () => ({ name: 'default' });
  
  const mockInitializeApp = (config) => {
    receivedConfig = config;
    return { name: 'new-app' };
  };
  
  const mockGetDatabase = (app) => ({ app, type: 'database' });
  
  testGetDatabaseInstanceLogic(mockConfig, mockApps, mockGetApp, mockInitializeApp, mockGetDatabase);
  
  assert.deepEqual(receivedConfig, mockConfig);
});

test('getDatabaseInstance returns database instance from getDatabase', () => {
  const mockConfig = { apiKey: 'test-key' };
  const mockApps = [{ name: 'default' }];
  let databaseApp = null;
  
  const mockGetApp = () => ({ name: 'default' });
  const mockInitializeApp = () => ({ name: 'new-app' });
  
  const mockGetDatabase = (app) => {
    databaseApp = app;
    return { app, type: 'database', instance: 'test-instance' };
  };
  
  const result = testGetDatabaseInstanceLogic(mockConfig, mockApps, mockGetApp, mockInitializeApp, mockGetDatabase);
  
  assert.equal(databaseApp.name, 'default');
  assert.equal(result.instance, 'test-instance');
  assert.equal(result.type, 'database');
});
