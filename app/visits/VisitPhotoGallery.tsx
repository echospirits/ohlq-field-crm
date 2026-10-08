'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../components/useDialogFocus';

type VisitPhoto = {
  id: string;
  url: string;
  caption: string | null;
  type: string;
};

type VisitPhotoGalleryProps = {
  photos: VisitPhoto[];
};

function VisitPhotoDialog({ photo, onClose }: { photo: VisitPhoto; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocus(dialogRef, true, onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const previousStyle = body.style.cssText;

    // A fixed body also prevents background touch scrolling in iOS Safari.
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('.photo-modal-close')?.focus();

    return () => {
      dialog.close();
      body.style.cssText = previousStyle;
      window.scrollTo(scrollX, scrollY);
      trigger?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      aria-label="Visit photo"
      className="photo-modal"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      ref={dialogRef}
    >
      <button aria-label="Close photo" className="photo-modal-backdrop" onClick={onClose} tabIndex={-1} type="button" />
      <div className="photo-modal-panel">
        <button autoFocus aria-label="Close photo" className="photo-modal-close" onClick={onClose} type="button">
          Close
        </button>
        <img alt={photo.caption || `${photo.type.toLowerCase()} visit photo`} src={photo.url} />
        <p><strong>{photo.type}</strong>{photo.caption ? ` - ${photo.caption}` : ''}</p>
      </div>
    </dialog>,
    document.body
  );
}

export function VisitPhotoGallery({ photos }: VisitPhotoGalleryProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<VisitPhoto | null>(null);

  if (photos.length === 0) {
    return <span className="muted">0</span>;
  }

  return (
    <>
      <div className="thumbnail-grid">
        {photos.map((photo) => (
          <button
            aria-label={`Open ${photo.type.toLowerCase()} photo`}
            className="thumbnail-button"
            key={photo.id}
            onClick={() => setSelectedPhoto(photo)}
            type="button"
          >
            <img alt={photo.caption || `${photo.type.toLowerCase()} visit photo`} src={photo.url} />
          </button>
        ))}
      </div>

      {selectedPhoto ? <VisitPhotoDialog photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} /> : null}
    </>
  );
}
