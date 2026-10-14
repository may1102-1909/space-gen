// src/App.tsx
import React, { useState } from 'react';
import { AholoViewer } from '../components/AholoViewer/AholoViewer';

export function App() {
  const [modelUrl, setModelUrl] = useState(
    'https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog'
  );

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 24px', background: '#202020', color: '#fff', display: 'flex', gap: '16px' }}>
        <span>Aholo 3D Viewer 集成演示</span>
        <button onClick={() => setModelUrl('https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog')}>
          加载 Bear (.sog)
        </button>
      </header>
      <main style={{ flex: 1, position: 'relative' }}>
        <AholoViewer
          src={modelUrl}
          coordinateSystem="opencv"
          backgroundColor="#18181b"
          onLoading={(loading) => console.log('Loading state:', loading)}
          onError={(err) => alert(`模型加载失败: ${err.message}`)}
        />
      </main>
    </div>
  );
}

export default App;
