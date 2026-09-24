import { useEffect, useState } from 'react';
import { API_PATHS, DEFAULT_SETTINGS, type Scene, type Settings } from '@emberglass/shared';
import { Notice } from '../ui/Notice.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request } from './api.js';
import { LiveBar } from './LiveBar.js';
import { ScenePanel } from './ScenePanel.js';
import { Library } from './library/Library.js';
import { SceneTree } from './tree/SceneTree.js';

// The DM workspace (specs/08-ux-journeys.md §1, Q-023): the live bar on top, the
// Campaign → Session → Scene tree on the left, the selected scene in the centre and
// the asset library on the right. The centre is the selected scene's setup and canvas
// (ScenePanel, PRP-02). Settings give the live scene
// and the upload limit; they are read again after a change in the tree, since
// deleting the live scene clears it (specs/03-domain-model.md §7).
export function Workspace({ mainId }: { mainId: string }) {
  const [selected, setSelected] = useState<Scene>();
  const [settings, setSettings] = useState<Settings>();
  const [failure, setFailure] = useState<string>();
  const [treeVersion, setTreeVersion] = useState(0);

  useEffect(() => {
    request<Settings>('GET', API_PATHS.settings).then(
      (value) => {
        setSettings(value);
        setFailure(undefined);
      },
      (error: unknown) => setFailure(errorMessage(errorCode(error))),
    );
  }, [treeVersion]);

  const treeChanged = () => setTreeVersion((each) => each + 1);

  return (
    <div className="eg-workspace">
      <LiveBar liveSceneId={settings?.live_scene_id} refreshKey={treeVersion} />
      {failure ? <Notice>{failure}</Notice> : null}
      <div className="eg-workspace__columns">
        <nav className="eg-workspace__sidebar" aria-label={t('tree.label')}>
          <SceneTree
            selectedSceneId={selected?.id}
            onSelectScene={setSelected}
            onScenesRemoved={(ids) => {
              if (selected && ids.includes(selected.id)) setSelected(undefined);
              treeChanged();
            }}
            onSceneRenamed={(scene) => {
              if (selected?.id === scene.id) setSelected(scene);
              treeChanged();
            }}
          />
        </nav>
        <main id={mainId} tabIndex={-1} className="eg-workspace__main" data-view="dm">
          {selected ? (
            <ScenePanel
              key={selected.id}
              sceneId={selected.id}
              name={selected.name}
              uploadLimit={settings?.upload_limit_bytes ?? DEFAULT_SETTINGS.upload_limit_bytes}
            />
          ) : (
            <>
              <h1 className="eg-dm__heading">{t('workspace.noScene')}</h1>
              <p className="eg-dm__status">{t('workspace.noSceneHint')}</p>
            </>
          )}
        </main>
        <aside className="eg-workspace__library" aria-label={t('library.label')}>
          <Library uploadLimit={settings?.upload_limit_bytes ?? DEFAULT_SETTINGS.upload_limit_bytes} />
        </aside>
      </div>
    </div>
  );
}
