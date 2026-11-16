<?php
header('Content-Type: application/json');
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
  echo json_encode(['ok' => false, 'error' => 'No JSON payload']);
  exit;
}

try {
  $db = new PDO('sqlite:' . __DIR__ . '/../neural_spider.sqlite');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec('CREATE TABLE IF NOT EXISTS patterns (hash TEXT PRIMARY KEY, cluster TEXT, label TEXT, text TEXT, pageNum INTEGER, ts INTEGER)');

  if (!empty($input['pattern'])) {
    $p = $input['pattern'];
    $stmt = $db->prepare('INSERT OR REPLACE INTO patterns (hash, cluster, label, text, pageNum, ts) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([$p['hash'], $p['cluster'], $p['label'], $p['text'], $p['pageNum'] ?? 1, time()]);
  }
  echo json_encode(['ok' => true]);
} catch (Exception $e) {
  echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
