from flask import Flask, jsonify, send_from_directory, request, send_file, Response, make_response
from flask_cors import CORS
import json
import os
import zipfile
import io
from datetime import datetime
import tempfile
import shutil
from PIL import Image
import piexif
import uuid

app = Flask(__name__)
CORS(app)

# Paths
ORIGINAL_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'original')
ORIGINAL_DIR = os.path.abspath(ORIGINAL_DIR)

# Debug: Print image directory and check if a sample image exists
print(f"[DEBUG] ORIGINAL_DIR: {ORIGINAL_DIR}")
sample_image = os.path.join(ORIGINAL_DIR, 'E-T 0010.jpg')
print(f"[DEBUG] Sample image path: {sample_image}")
print(f"[DEBUG] Sample image exists: {os.path.exists(sample_image)}")

CROPS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'crops')
CROPS_DIR = os.path.abspath(CROPS_DIR)

# New data structure files
IMAGES_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'images.json')
IMAGES_FILE = os.path.abspath(IMAGES_FILE)
GROUPS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'groups.json')
GROUPS_FILE = os.path.abspath(GROUPS_FILE)
FACES_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'faces.json')
FACES_FILE = os.path.abspath(FACES_FILE)

# Legacy files (for backward compatibility)
CLUSTERS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'clusters_faces.json')
CLUSTERS_FILE = os.path.abspath(CLUSTERS_FILE)
FACES_OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'faces_output.json')
FACES_OUTPUT_FILE = os.path.abspath(FACES_OUTPUT_FILE)

# Create crops directory if it doesn't exist
os.makedirs(CROPS_DIR, exist_ok=True)

# New moments file
MOMENTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'moments.json')

def load_images():
    """Load images data"""
    try:
        with open(IMAGES_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('images', [])
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []

def load_groups():
    """Load groups data"""
    try:
        with open(GROUPS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('groups', [])
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []

def load_faces():
    """Load faces data"""
    try:
        with open(FACES_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('faces', [])
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []

def save_groups(groups):
    """Save groups data"""
    try:
        data = {'groups': groups}
        with open(GROUPS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving groups: {e}")
        return False

def get_group_with_faces(group_id):
    """Get a group with all its faces and images"""
    groups = load_groups()
    faces = load_faces()
    images = load_images()
    
    # Find the group
    group = next((g for g in groups if g['groupID'] == group_id), None)
    if not group:
        return None
    
    # Get all faces for this group
    group_faces = [f for f in faces if f['groupID'] == group_id]
    
    # Get image names for all faces
    image_id_to_name = {img['imageID']: img['name'] for img in images}
    
    # Create image_ids list (unique image names)
    image_ids = list(set([image_id_to_name.get(f['imageID'], '') for f in group_faces]))
    
    # Get representative image name
    representative_image_name = image_id_to_name.get(group.get('representative_imageID', ''), '')
    
    # Get representative crop filename
    representative_face = next((f for f in group_faces if f['faceID'] == group.get('representative_faceID')), None)
    representative_crop = representative_face['crop_filename'] if representative_face else None
    
    # Create legacy-compatible group structure
    legacy_group = {
        'id': group['groupID'],
        'label': group['name'],
        'representative': representative_image_name,
        'representative_crop': representative_crop,
        'image_ids': image_ids,
        'updated_at': group.get('updated_at', '')
    }
    
    return legacy_group

def get_all_groups_legacy():
    """Get all groups in legacy format for frontend compatibility"""
    groups = load_groups()
    result = []
    
    for group in groups:
        legacy_group = get_group_with_faces(group['groupID'])
        if legacy_group:
            result.append(legacy_group)
    
    return result

# Legacy functions for backward compatibility
def load_clusters():
    """Load face clusters data (legacy)"""
    return get_all_groups_legacy()

def save_clusters(clusters):
    """Save face clusters data (legacy)"""
    # This would need to be updated to work with new structure
    # For now, return False to indicate it's not supported
    return False

def load_faces_output():
    """Load faces output data (legacy)"""
    try:
        with open(FACES_OUTPUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {}

def get_faces_in_image(image_filename):
    """Get faces detected in a specific image (legacy)"""
    faces_data = load_faces_output()
    return faces_data.get(image_filename, [])

def load_moments():
    with open(MOMENTS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f).get('moments', [])

def save_moments(moments):
    with open(MOMENTS_FILE, 'w', encoding='utf-8') as f:
        json.dump({'moments': moments}, f, ensure_ascii=False, indent=2)

@app.route("/api/ping")
def ping():
    print("Ping endpoint called")
    return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})

@app.route("/api/test")
def test():
    """Test endpoint to verify backend is working"""
    print("Test endpoint called")
    return jsonify({
        "status": "ok", 
        "images_dir": ORIGINAL_DIR,
        "images_dir_exists": os.path.exists(ORIGINAL_DIR),
        "groups_file_exists": os.path.exists(GROUPS_FILE),
        "faces_file_exists": os.path.exists(FACES_FILE)
    })

@app.route("/api/groups")
def get_groups():
    """Get all face groups"""
    groups = get_all_groups_legacy()
    return jsonify(groups)

@app.route("/api/groups/<int:group_id>")
def get_group(group_id):
    """Get a specific face group"""
    group = get_group_with_faces(group_id)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    return jsonify(group)

@app.route("/api/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    """Update a face group"""
    groups = load_groups()
    faces = load_faces()
    images = load_images()
    
    group = next((g for g in groups if g['groupID'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    data = request.get_json()
    
    # Update allowed fields
    if 'label' in data:
        group['name'] = data['label']
    
    if 'representative' in data:
        # Find the image ID for the new representative image
        new_representative_image_name = data['representative']
        image_id = next((img['imageID'] for img in images if img['name'] == new_representative_image_name), None)
        
        if not image_id:
            return jsonify({"error": "Representative image not found"}), 400
        
        # Find a face in this group that belongs to the new representative image
        group_faces = [f for f in faces if f['groupID'] == group_id and f['imageID'] == image_id]
        
        if not group_faces:
            return jsonify({"error": "No faces found in the selected image for this group"}), 400
        
        # Use the first face found in the new representative image
        new_representative_face = group_faces[0]
        
        # Update the group's representative
        group['representative_imageID'] = image_id
        group['representative_faceID'] = new_representative_face['faceID']
    
    group['updated_at'] = datetime.now().isoformat()
    
    if save_groups(groups):
        return jsonify(get_group_with_faces(group_id))
    else:
        return jsonify({"error": "Failed to save changes"}), 500

@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    """Delete a face group"""
    groups = load_groups()
    group = next((g for g in groups if g['groupID'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    groups = [g for g in groups if g['groupID'] != group_id]
    
    if save_groups(groups):
        return jsonify({"message": "Group deleted successfully"})
    else:
        return jsonify({"error": "Failed to delete group"}), 500

@app.route("/api/groups/<int:group_id>/download")
def download_group(group_id):
    """Download all photos from a face group"""
    temp_file = None
    try:
        group = get_group_with_faces(group_id)
        
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Create a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_path = temp_file.name
        temp_file.close()
        
        # Create zip file on disk
        added_files = 0
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for image_id in group.get('image_ids', []):
                image_path = os.path.join(ORIGINAL_DIR, image_id)
                if os.path.exists(image_path):
                    zip_file.write(image_path, image_id)
                    added_files += 1
                else:
                    print(f"Warning: Image not found: {image_path}")
        
        filename = f"{group.get('label', f'Person_{group_id}')}.zip"
        return send_file(
            temp_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Error downloading group {group_id}: {e}")
        return jsonify({"error": "Failed to download group"}), 500
    finally:
        # Clean up temporary file after sending
        if temp_file and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass

@app.route("/api/groups/<int:group_id>/download-selected", methods=["POST"])
def download_selected_photos(group_id):
    """Download selected photos from a face group"""
    temp_file = None
    try:
        group = get_group_with_faces(group_id)
        
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        data = request.get_json()
        photo_ids = data.get('photoIds', [])
        
        if not photo_ids:
            return jsonify({"error": "No photos selected"}), 400
        
        # Verify all selected photos belong to the group
        group_photos = set(group.get('image_ids', []))
        if not all(photo_id in group_photos for photo_id in photo_ids):
            return jsonify({"error": "Some selected photos don't belong to this group"}), 400
        
        # Create a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_path = temp_file.name
        temp_file.close()
        
        # Create zip file on disk
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for image_id in photo_ids:
                image_path = os.path.join(ORIGINAL_DIR, image_id)
                if os.path.exists(image_path):
                    zip_file.write(image_path, image_id)
                else:
                    print(f"Warning: Image not found: {image_path}")
        
        filename = f"{group.get('label', f'Person_{group_id}')}_selected.zip"
        return send_file(
            temp_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Error downloading selected photos for group {group_id}: {e}")
        return jsonify({"error": "Failed to download selected photos"}), 500
    finally:
        # Clean up temporary file after sending
        if temp_file and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass

@app.route("/api/download-all")
def download_all_photos():
    """Download all photos from all groups"""
    temp_file = None
    try:
        groups = get_all_groups_legacy()
        
        # Create a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_path = temp_file.name
        temp_file.close()
        
        # Create zip file on disk
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add all unique photos
            all_photos = set()
            for group in groups:
                all_photos.update(group.get('image_ids', []))
            
            for image_id in all_photos:
                image_path = os.path.join(ORIGINAL_DIR, image_id)
                if os.path.exists(image_path):
                    zip_file.write(image_path, image_id)
                else:
                    print(f"Warning: Image not found: {image_path}")
        
        return send_file(
            temp_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name='face-gallery-all.zip'
        )
    except Exception as e:
        print(f"Error downloading all photos: {e}")
        return jsonify({"error": "Failed to download all photos"}), 500
    finally:
        # Clean up temporary file after sending
        if temp_file and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass

@app.route("/api/photos/<path:filename>/faces")
def get_faces_in_photo(filename):
    """Get faces detected in a specific photo"""
    try:
        faces_data = load_faces()
        groups = load_groups()
        images = load_images()
        
        # Create mapping from image name to image ID
        image_name_to_id = {img['name']: img['imageID'] for img in images}
        image_id = image_name_to_id.get(filename)
        
        if not image_id:
            return jsonify({"error": "Image not found"}), 404
        
        # Get all faces for this image
        image_faces = [f for f in faces_data if f['imageID'] == image_id]
        
        # Create face groups with proper data
        face_groups = []
        for face in image_faces:
            # Find the group this face belongs to
            group = next((g for g in groups if g['groupID'] == face['groupID']), None)
            
            if group:
                # Get group label
                group_label = group.get('name', f'Person_{group["groupID"]}')
                
                # Get representative crop
                representative_face = next((f for f in faces_data if f['faceID'] == group.get('representative_faceID')), None)
                representative_crop = representative_face['crop_filename'] if representative_face else None
                
                face_groups.append({
                    'face_coords': {
                        'Left': face['left'],
                        'Top': face['top'],
                        'Width': face['width'],
                        'Height': face['height']
                    },
                    'group_id': face['groupID'],
                    'group_label': group_label,
                    'group_representative': representative_crop,
                    'face_crop': face['crop_filename']
                })
        
        return jsonify({
            'filename': filename,
            'faces': face_groups
        })
    except Exception as e:
        print(f"Error getting faces for photo {filename}: {e}")
        return jsonify({"error": "Failed to get faces"}), 500

@app.route("/api/photos/<path:filename>/info")
def get_photo_info(filename):
    """Get information about a specific photo"""
    try:
        images = load_images()
        # Find the image entry by name or any path
        photo = next((img for img in images if img['name'] == filename or img.get('original_path') == filename or img.get('display_path') == filename or img.get('thumb_path') == filename), None)
        if not photo:
            return jsonify({"error": "Image not found"}), 404
        # Return all fields as-is
        return jsonify(photo)
    except Exception as e:
        print(f"Error getting photo info for {filename}: {e}")
        return jsonify({"error": "Failed to get photo info"}), 500

@app.route("/api/photos/<path:filename>/moment")
def get_photo_moment(filename):
    """Get the moment that contains this photo"""
    try:
        moments = load_moments()
        
        # Get the photo's date taken
        image_path = os.path.join(ORIGINAL_DIR, filename)
        photo_date = None
        
        if os.path.exists(image_path):
            try:
                with Image.open(image_path) as img:
                    exif_data = img.info.get('exif')
                    if exif_data:
                        exif_dict = piexif.load(exif_data)
                        date_bytes = exif_dict['Exif'].get(piexif.ExifIFD.DateTimeOriginal)
                        if date_bytes:
                            date_str = date_bytes.decode('utf-8')
                            # EXIF format: YYYY:MM:DD HH:MM:SS
                            photo_date = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
            except Exception as e:
                print(f"Error reading EXIF for {filename}: {e}")
        
        if not photo_date:
            return jsonify({"error": "Could not determine photo date"}), 404
        
        # First check if photo is manually assigned to any moment
        for moment in moments:
            if 'photos' in moment and moment['photos'] and filename in moment['photos']:
                return jsonify({
                    'id': moment['id'],
                    'title': moment['title'],
                    'description': moment.get('description', ''),
                    'start_datetime': moment['start_datetime'],
                    'end_datetime': moment['end_datetime'],
                    'representative_photo': moment.get('representative_photo', '')
                })
        
        # Fallback to time-based assignment
        for moment in moments:
            start_dt = moment.get('start_datetime')
            end_dt = moment.get('end_datetime')
            
            if start_dt and end_dt:
                try:
                    start = datetime.fromisoformat(start_dt)
                    end = datetime.fromisoformat(end_dt)
                    
                    if start <= photo_date <= end:
                        return jsonify({
                            'id': moment['id'],
                            'title': moment['title'],
                            'description': moment.get('description', ''),
                            'start_datetime': moment['start_datetime'],
                            'end_datetime': moment['end_datetime'],
                            'representative_photo': moment.get('representative_photo', '')
                        })
                except Exception as e:
                    print(f"Error parsing moment dates for {moment['id']}: {e}")
                    continue
        
        return jsonify({"error": "Photo not found in any moment"}), 404
        
    except Exception as e:
        print(f"Error getting moment for photo {filename}: {e}")
        return jsonify({"error": "Failed to get photo moment"}), 500

# Serve images
@app.route('/original/<path:filename>')
def get_original(filename):
    return send_from_directory(ORIGINAL_DIR, filename)

# Serve display images
@app.route('/display/<path:filename>')
def get_display(filename):
    display_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'display'))
    return send_from_directory(display_dir, filename)

# Serve thumb images
@app.route('/thumb/<path:filename>')
def get_thumb(filename):
    thumb_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'thumb'))
    return send_from_directory(thumb_dir, filename)

@app.route("/api/groups/<int:group_id>/crops")
def get_group_crops(group_id):
    """Get crop filenames for all images in a group"""
    try:
        groups = load_groups()
        faces = load_faces()
        images = load_images()
        
        # Find the group
        group = next((g for g in groups if g['groupID'] == group_id), None)
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Get all faces for this group
        group_faces = [f for f in faces if f['groupID'] == group_id]
        
        # Get image names for all faces
        image_id_to_name = {img['imageID']: img['name'] for img in images}
        
        # Create mapping of image names to crop filenames
        image_crops = {}
        for face in group_faces:
            image_name = image_id_to_name.get(face['imageID'], '')
            if image_name:
                # If multiple faces in same image, use the first one
                if image_name not in image_crops:
                    image_crops[image_name] = face['crop_filename']
        
        return jsonify({
            'group_id': group_id,
            'image_crops': image_crops
        })
    except Exception as e:
        print(f"Error getting crops for group {group_id}: {e}")
        return jsonify({"error": "Failed to get group crops"}), 500

@app.route("/api/groups/<int:group_id>/photos")
def get_group_photos(group_id):
    """Get photos for a group with optional sorting by date"""
    try:
        group = get_group_with_faces(group_id)
        
        if not group:
            return jsonify({"error": "Group not found"}), 404
        
        # Get sort parameters from query string
        sort_by = request.args.get('sort_by', 'date')  # 'date' or 'name'
        sort_order = request.args.get('sort_order', 'asc')  # 'asc' or 'desc'
        
        photos = group.get('image_ids', [])
        
        if sort_by == 'date':
            # Get photo info for all photos in the group
            photos_with_dates = []
            for photo_id in photos:
                try:
                    # Get photo info
                    image_path = os.path.join(ORIGINAL_DIR, photo_id)
                    date_taken = None
                    
                    if os.path.exists(image_path):
                        with Image.open(image_path) as img:
                            exif_data = img.info.get('exif')
                            if exif_data:
                                exif_dict = piexif.load(exif_data)
                                date_bytes = exif_dict['Exif'].get(piexif.ExifIFD.DateTimeOriginal)
                                if date_bytes:
                                    date_taken = date_bytes.decode('utf-8')
                    
                    photos_with_dates.append({
                        'photo_id': photo_id,
                        'date_taken': date_taken
                    })
                except Exception as e:
                    print(f"Error getting date for {photo_id}: {e}")
                    photos_with_dates.append({
                        'photo_id': photo_id,
                        'date_taken': None
                    })
            
            # Sort by date
            def parse_exif_date(date_string):
                if not date_string:
                    return datetime.min
                try:
                    # Convert EXIF format "YYYY:MM:DD HH:MM:SS" to datetime
                    return datetime.strptime(date_string, "%Y:%m:%d %H:%M:%S")
                except:
                    return datetime.min
            
            photos_with_dates.sort(
                key=lambda x: parse_exif_date(x['date_taken']),
                reverse=(sort_order == 'desc')
            )
            
            # Return sorted photo IDs and their dates
            return jsonify({
                'photos': [
                    {
                        'photo_id': p['photo_id'],
                        'date_taken': p['date_taken'],
                        'formatted_date': parse_exif_date(p['date_taken']).strftime("%Y-%m-%d %H:%M:%S") if p['date_taken'] else None
                    }
                    for p in photos_with_dates
                ]
            })
        
        else:
            # Sort by name
            photos.sort(reverse=(sort_order == 'desc'))
            return jsonify({
                'photos': [
                    {
                        'photo_id': photo_id,
                        'date_taken': None,
                        'formatted_date': None
                    }
                    for photo_id in photos
                ]
            })
            
    except Exception as e:
        print(f"Error getting group photos for {group_id}: {e}")
        return jsonify({"error": "Failed to get group photos"}), 500

@app.route('/api/moments', methods=['GET'])
def get_moments():
    moments = load_moments()
    return jsonify({'moments': moments})

@app.route('/api/moments', methods=['POST'])
def create_moment():
    data = request.json or {}
    moments = load_moments()
    new_moment = {
        'id': str(uuid.uuid4()),
        'title': data.get('title', ''),
        'start_datetime': data.get('start_datetime', ''),
        'end_datetime': data.get('end_datetime', ''),
        'representative_photo': data.get('representative_photo', ''),
        'description': data.get('description', '')
    }
    moments.append(new_moment)
    save_moments(moments)
    return jsonify({'moment': new_moment}), 201

@app.route('/api/moments/<moment_id>', methods=['PUT'])
def update_moment(moment_id):
    data = request.json or {}
    moments = load_moments()
    for moment in moments:
        if moment['id'] == moment_id:
            moment['title'] = data.get('title', moment['title'])
            moment['start_datetime'] = data.get('start_datetime', moment['start_datetime'])
            moment['end_datetime'] = data.get('end_datetime', moment['end_datetime'])
            moment['representative_photo'] = data.get('representative_photo', moment['representative_photo'])
            moment['description'] = data.get('description', moment.get('description', ''))
            # Always update the photos field, even if empty
            moment['photos'] = data.get('photos', [])
            save_moments(moments)
            return jsonify({'moment': moment})
    return jsonify({'error': 'Moment not found'}), 404

@app.route('/api/moments/<moment_id>', methods=['DELETE'])
def delete_moment(moment_id):
    moments = load_moments()
    new_moments = [m for m in moments if m['id'] != moment_id]
    if len(new_moments) == len(moments):
        return jsonify({'error': 'Moment not found'}), 404
    save_moments(new_moments)
    return jsonify({'status': 'deleted'})

@app.route('/api/moments/<moment_id>/photos', methods=['GET'])
def get_moment_photos(moment_id):
    moments = load_moments()
    moment = next((m for m in moments if m['id'] == moment_id), None)
    if not moment:
        return jsonify({'error': 'Moment not found'}), 404
    
    # Only use manually assigned photos from the moments.json
    if 'photos' in moment and moment['photos']:
        images = load_images()
        photos_in_range = []
        
        for photo_name in moment['photos']:
            # Get timestamp for the photo
            image_path = os.path.join(ORIGINAL_DIR, photo_name)
            date_taken = None
            if os.path.exists(image_path):
                try:
                    with Image.open(image_path) as im:
                        exif_data = im.info.get('exif')
                        if exif_data:
                            exif_dict = piexif.load(exif_data)
                            date_bytes = exif_dict['Exif'].get(piexif.ExifIFD.DateTimeOriginal)
                            if date_bytes:
                                date_str = date_bytes.decode('utf-8')
                                # EXIF format: YYYY:MM:DD HH:MM:SS
                                date_taken = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
                except Exception as e:
                    print(f"Error reading EXIF for {photo_name}: {e}")
            
            photos_in_range.append({
                'name': photo_name,
                'date_taken': date_taken.isoformat() if date_taken else None
            })
        
        return jsonify({'photos': photos_in_range})
    
    # If no photos field, return empty array
    return jsonify({'photos': []})

@app.route('/api/moments/<moment_id>/photos-in-period', methods=['GET'])
def get_photos_in_moment_period(moment_id):
    """Get all photos that fall within a moment's time period"""
    try:
        moments = load_moments()
        moment = next((m for m in moments if m['id'] == moment_id), None)
        if not moment:
            return jsonify({'error': 'Moment not found'}), 404
        
        start_dt = moment.get('start_datetime')
        end_dt = moment.get('end_datetime')
        if not start_dt or not end_dt:
            return jsonify({'photos': []})
        
        def parse_iso(dt):
            try:
                return datetime.fromisoformat(dt)
            except:
                return None
        
        start = parse_iso(start_dt)
        end = parse_iso(end_dt)
        if not start or not end:
            return jsonify({'photos': []})
        
        # Get all images and check which ones fall in the time period
        images = load_images()
        photos_in_period = []
        
        for img in images:
            filename = img['name']
            image_path = os.path.join(ORIGINAL_DIR, filename)
            date_taken = None
            if os.path.exists(image_path):
                try:
                    with Image.open(image_path) as im:
                        exif_data = im.info.get('exif')
                        if exif_data:
                            exif_dict = piexif.load(exif_data)
                            date_bytes = exif_dict['Exif'].get(piexif.ExifIFD.DateTimeOriginal)
                            if date_bytes:
                                date_str = date_bytes.decode('utf-8')
                                # EXIF format: YYYY:MM:DD HH:MM:SS
                                date_taken = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
                except Exception as e:
                    print(f"Error reading EXIF for {filename}: {e}")
                    # Continue with next image instead of failing completely
            else:
                print(f"File does not exist: {image_path}")
                
            if date_taken and start <= date_taken <= end:
                photos_in_period.append({
                    'name': filename,
                    'date_taken': date_taken.isoformat()
                })
        
        return jsonify({'photos': photos_in_period})
    except Exception as e:
        print(f"Error in get_photos_in_moment_period: {e}")
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500

@app.route('/api/download-selected-moment', methods=['POST'])
def download_selected_moment_photos():
    try:
        data = request.json or {}
        moment_id = data.get('momentId')
        photo_names = data.get('photoNames', [])
        
        if not moment_id or not photo_names:
            return jsonify({"error": "Missing moment ID or photo names"}), 400
        
        # Verify the moment exists
        moments = load_moments()
        moment = next((m for m in moments if m['id'] == moment_id), None)
        if not moment:
            return jsonify({"error": "Moment not found"}), 404
        
        # Create ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for photo_name in photo_names:
                photo_path = os.path.join(ORIGINAL_DIR, photo_name)
                if os.path.exists(photo_path):
                    zip_file.write(photo_path, photo_name)
        
        zip_buffer.seek(0)
        
        response = make_response(zip_buffer.getvalue())
        response.headers['Content-Type'] = 'application/zip'
        response.headers['Content-Disposition'] = f'attachment; filename=moment_{moment.get("title", "photos")}.zip'
        
        return response
        
    except Exception as e:
        print(f"Error downloading moment photos: {e}")
        return jsonify({"error": "Failed to download photos"}), 500

@app.route('/api/images.json')
def get_images_json():
    """Get the images.json file for frontend use"""
    try:
        with open(IMAGES_FILE, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except FileNotFoundError:
        return jsonify({"images": []})
    except json.JSONDecodeError:
        return jsonify({"images": []})

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)
