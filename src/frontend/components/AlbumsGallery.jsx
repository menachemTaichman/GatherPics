import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ArrowUp, ArrowDown } from 'lucide-react';
import { albumsAPI } from '../utils/apiService';
import { useSetting } from '../utils/useSettings';
import { Link } from 'react-router-dom';

export default function AlbumsGallery({ eventUrl }) {
  const [albums, setAlbums] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useSetting('albumsGallery_sortOrder', 'asc');

  useEffect(() => {
    async function loadAlbums() {
      try {
        const res = await albumsAPI.getAll(eventUrl);
        setAlbums(res.albums || []);
      } catch (e) {
        console.error('Failed to load albums', e);
      }
    }
    if (eventUrl) loadAlbums();
  }, [eventUrl]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const arr = (albums || []).filter(a => (a.label || '').toLowerCase().includes(term));
    const fixed = arr.filter(a => ['archive', 'favorites'].includes((a.label || '').toLowerCase()));
    const rest = arr.filter(a => !['archive', 'favorites'].includes((a.label || '').toLowerCase()))
      .sort((a, b) => {
        const na = (a.label || '').toLowerCase();
        const nb = (b.label || '').toLowerCase();
        return sortOrder === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
      });
    return [...fixed, ...rest];
  }, [albums, searchTerm, sortOrder]);

  return (
    <div className="w-full">
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Albums</h1>
            <p className="text-gray-600">{filtered.length} of {(albums || []).length} albums</p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search albums..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
              />
            </div>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-8">
        {filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
            <div className="w-16 h-16 rounded-lg bg-gray-100 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No albums found</h3>
            <p className="text-gray-500">Create an album from image actions</p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {filtered.map((album, index) => (
              <motion.div key={album.id || `${album.label || 'album'}-${index}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                <Link to={`/${eventUrl}/albums/${encodeURIComponent(album.label)}`} className="block" title={album.label}>
                  <div className="relative rounded-lg border border-gray-200 bg-white hover:shadow-md transition-shadow h-40 p-4 flex flex-col justify-between">
                    <div className="text-lg font-semibold text-gray-900 truncate">{album.label}</div>
                    <div className="text-sm text-gray-500">{(album.image_ids || []).length} images</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}


