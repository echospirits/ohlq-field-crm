'use client';

import { useState } from 'react';

type VisitPhoto = {
  id: string;
  url: string;
  caption: string | null;
  type: string;
};

type VisitPhotoGalleryProps = {
  photos: VisitPhoto[];
};

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

      {selectedPhoto ? (
        <div className="photo-modal" role="dialog" aria-modal="true">
          <button className="photo-modal-backdrop" onClick={() => setSelectedPhoto(null)} type="button" />
          <div className="photo-modal-panel">
            <button
              aria-label="Close photo"
              className="photo-modal-close"
              onClick={() => setSelectedPhoto(null)}
              type="button"
            >
              Close
            </button>
            <img alt={selectedPhoto.caption || `${selectedPhoto.type.toLowerCase()} visit photo`} src={selectedPhoto.url} />
            <p>
              <strong>{selectedPhoto.type}</strong>
              {selectedPhoto.caption ? ` - ${selectedPhoto.caption}` : ''}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
