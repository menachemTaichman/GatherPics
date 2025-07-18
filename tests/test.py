from src.core.models.event import Event
from src.core.models.events_manager import EventsManager
"""
# 1. Create an EventsManager
event_manager = EventsManager.add(name='Test Manager')
print('Created EventsManager:', event_manager.get_info())

# 2. Create an Event belonging to the manager
event = Event.add(name='Test Event', events_manager=event_manager.id)
print('Created Event:', event.get_info())
"""
event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
event = Event(event_id)
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"

event.db.execute_query('DELETE FROM faces;')
event.db.execute_query('DELETE FROM groups;')
event.db.execute_query('DELETE FROM images;')
event.db.execute_query('DELETE FROM moments;')

event.face_utils.rek_helper.clear_collection()

# 3. Process images if any are in the event's to_process directory
result = event.process_new_images(verbose=True)
print('Image processing result:', result)


faces = event.faces_model.list()
print(faces)

groups = event.groups_model.list()
print(groups)