SELECT json_extract(payload, '$.batchId') as batch, status, count(*) FROM task_queue GROUP BY batch, status;
