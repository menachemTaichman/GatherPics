import { useState, useEffect } from 'react';
import axios from 'axios';

export default function App() {
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    axios.get('/api/groups')
      .then(res => setGroups(res.data))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-3xl mb-6 font-bold">גלריית זיהוי פנים</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {groups.map(group => (
          <div key={group.id} className="border rounded-lg p-2 shadow-sm">
            <img 
              src={`/images/${group.representative}`} 
              alt={group.label || `קבוצה #${group.id}`} 
              className="w-full h-48 object-cover rounded-md mb-2"
            />
            <h2 className="text-center font-semibold text-lg">
              {group.label || `קבוצה #${group.id}`}
            </h2>
          </div>
        ))}
      </div>
    </div>
  );
}
