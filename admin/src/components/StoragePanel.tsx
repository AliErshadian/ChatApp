import { AdminStorageStats } from '../services/api';
import { formatBytes, formatNumber, formatPercent } from '../utils/format';

interface Props {
  storage: AdminStorageStats;
}

const KIND_COLORS: Record<string, string> = {
  text: '#64748b',
  image: '#3b82f6',
  video: '#8b5cf6',
  audio: '#f59e0b',
  document: '#22c55e',
};

const FILE_COLORS: Record<string, string> = {
  avatars: '#3b82f6',
  channel_avatars: '#8b5cf6',
  message_attachments: '#22c55e',
  other: '#64748b',
};

export function StoragePanel({ storage }: Props) {
  const dbBytes = storage.database.totalBytes;
  const fileBytes = storage.files.totalBytes;
  const total = Math.max(storage.totalBytes, dbBytes + fileBytes);

  return (
    <section className="panel storage-panel">
      <h2>Storage</h2>
      <p className="panel-intro">
        Total estimated usage: <strong>{formatBytes(total)}</strong>
        <span className="muted">
          {' '}
          · Database {formatBytes(dbBytes)} · Files {formatBytes(fileBytes)}
        </span>
      </p>

      <div className="storage-overview">
        <div className="bar-chart storage-bar">
          <div
            className="bar-segment bar-db"
            style={{ width: `${total ? (dbBytes / total) * 100 : 0}%` }}
            title={`Database: ${formatBytes(dbBytes)}`}
          />
          <div
            className="bar-segment bar-files"
            style={{ width: `${total ? (fileBytes / total) * 100 : 0}%` }}
            title={`Files: ${formatBytes(fileBytes)}`}
          />
        </div>
        <div className="bar-legend">
          <span><i className="dot dot-db" /> Database</span>
          <span><i className="dot dot-files" /> Upload files</span>
        </div>
      </div>

      <div className="storage-grid">
        <div className="storage-block">
          <h3>Upload files</h3>
          {storage.files.categories.length === 0 ? (
            <p className="muted">No uploaded files yet.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {storage.files.categories.map((cat) => (
                  <tr key={cat.id}>
                    <td>
                      <span className="storage-type">
                        <i
                          className="dot"
                          style={{ background: FILE_COLORS[cat.id] ?? '#64748b' }}
                        />
                        {cat.label}
                      </span>
                    </td>
                    <td>{formatNumber(cat.fileCount)}</td>
                    <td>{formatBytes(cat.bytes)}</td>
                    <td>{formatPercent(cat.bytes, fileBytes || 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="storage-block">
          <h3>Message data types</h3>
          {storage.messages.byKind.length === 0 ? (
            <p className="muted">No messages yet.</p>
          ) : (
            <>
              <div className="inline-stats compact">
                <div>
                  <span>Text</span>
                  <strong>{formatNumber(storage.messages.textCount)}</strong>
                </div>
                <div>
                  <span>Attachments</span>
                  <strong>{formatNumber(storage.messages.attachmentCount)}</strong>
                </div>
                <div>
                  <span>Attachment size</span>
                  <strong>{formatBytes(storage.messages.attachmentBytes)}</strong>
                </div>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Count</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.messages.byKind.map((item) => (
                    <tr key={item.kind}>
                      <td>
                        <span className="storage-type">
                          <i
                            className="dot"
                            style={{ background: KIND_COLORS[item.kind] ?? '#64748b' }}
                          />
                          {item.label}
                        </span>
                      </td>
                      <td>{formatNumber(item.count)}</td>
                      <td>{item.kind === 'text' ? '—' : formatBytes(item.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="storage-block storage-block-wide">
          <h3>Database tables</h3>
          <p className="muted small">
            Total database size: {formatBytes(dbBytes)}
          </p>
          {storage.database.tables.length === 0 ? (
            <p className="muted">No table data available.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>~Rows</th>
                  <th>Size</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {storage.database.tables.map((table) => (
                  <tr key={table.name}>
                    <td className="mono-cell">{table.name}</td>
                    <td>{formatNumber(table.approxRows)}</td>
                    <td>{formatBytes(table.bytes)}</td>
                    <td>{formatPercent(table.bytes, dbBytes || 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
