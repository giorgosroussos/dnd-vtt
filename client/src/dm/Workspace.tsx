import { useState } from 'react';
import type { Scene } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { SceneTree } from './tree/SceneTree.js';

// The DM workspace (specs/08-ux-journeys.md §1, Q-023): the Campaign → Session →
// Scene tree on the left and the selected scene in the centre. The canvas is
// PRP-02; the library panel and the live bar arrive with the second part of PRP-01.
export function Workspace({ mainId }: { mainId: string }) {
  const [selected, setSelected] = useState<Scene>();
  return (
    <div className="eg-workspace">
      <nav className="eg-workspace__sidebar" aria-label={t('tree.label')}>
        <SceneTree
          selectedSceneId={selected?.id}
          onSelectScene={setSelected}
          onScenesRemoved={(ids) => {
            if (selected && ids.includes(selected.id)) setSelected(undefined);
          }}
          onSceneRenamed={(scene) => {
            if (selected?.id === scene.id) setSelected(scene);
          }}
        />
      </nav>
      <main id={mainId} tabIndex={-1} className="eg-workspace__main" data-view="dm">
        <h1 className="eg-dm__heading">{selected ? selected.name : t('workspace.noScene')}</h1>
        <p className="eg-dm__status">{selected ? t('workspace.sceneHint') : t('workspace.noSceneHint')}</p>
      </main>
    </div>
  );
}
