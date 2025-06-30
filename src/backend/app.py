from flask import Flask, jsonify, send_from_directory, request, send_file, Response
from flask_cors import CORS
import json
import os
import zipfile
import io
from datetime import datetime
import tempfile
import shutil

app = Flask(__name__)
CORS(app)

# Paths
IMAGES_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'images')
IMAGES_DIR = os.path.abspath(IMAGES_DIR)
CROPS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'crops')
CROPS_DIR = os.path.abspath(CROPS_DIR)
CLUSTERS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'clusters_faces.json')
CLUSTERS_FILE = os.path.abspath(CLUSTERS_FILE)
FACES_OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'faces_output.json')
FACES_OUTPUT_FILE = os.path.abspath(FACES_OUTPUT_FILE)

# Create crops directory if it doesn't exist
os.makedirs(CROPS_DIR, exist_ok=True)

def load_clusters():
    """Load face clusters data"""
    try:
        with open(CLUSTERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('clusters', [])
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []

def save_clusters(clusters):
    """Save face clusters data"""
    try:
        data = {'clusters': clusters}
        with open(CLUSTERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving clusters: {e}")
        return False

def load_faces_output():
    """Load faces output data"""
    try:
        with open(FACES_OUTPUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {}

def get_faces_in_image(image_filename):
    """Get faces detected in a specific image"""
    faces_data = load_faces_output()
    return faces_data.get(image_filename, [])

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
        "images_dir": IMAGES_DIR,
        "images_dir_exists": os.path.exists(IMAGES_DIR),
        "clusters_file_exists": os.path.exists(CLUSTERS_FILE)
    })

@app.route("/api/groups")
def get_groups():
    """Get all face groups"""
    clusters = load_clusters()
    # Ensure each group has a 'representative_crop' field with just the filename
    for group in clusters:
        rep = group.get('representative', '')
        # Normalize slashes and extract the filename
        rep_filename = os.path.basename(rep.replace('\\', '/').replace('\\', '/'))
        group['representative_crop'] = rep_filename
    return jsonify(clusters)

@app.route("/api/groups/<int:group_id>")
def get_group(group_id):
    """Get a specific face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    return jsonify(group)

@app.route("/api/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    """Update a face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    data = request.get_json()
    
    # Update allowed fields
    if 'label' in data:
        group['label'] = data['label']
    if 'representative' in data:
        # Verify the representative image exists in the group
        if data['representative'] in group.get('image_ids', []):
            group['representative'] = data['representative']
            # Update representative crop
            group['representative_crop'] = f"{os.path.splitext(data['representative'])[0]}_crop.jpg"
        else:
            return jsonify({"error": "Representative image not found in group"}), 400
    
    group['updated_at'] = datetime.now().isoformat()
    
    if save_clusters(clusters):
        return jsonify(group)
    else:
        return jsonify({"error": "Failed to save changes"}), 500

@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    """Delete a face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    clusters = [g for g in clusters if g['id'] != group_id]
    
    if save_clusters(clusters):
        return jsonify({"message": "Group deleted successfully"})
    else:
        return jsonify({"error": "Failed to delete group"}), 500

@app.route("/api/groups/<int:group_id>/download")
def download_group(group_id):
    """Download all photos from a face group"""
    temp_file = None
    try:
        clusters = load_clusters()
        group = next((g for g in clusters if g['id'] == group_id), None)
        
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
                image_path = os.path.join(IMAGES_DIR, image_id)
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
        clusters = load_clusters()
        group = next((g for g in clusters if g['id'] == group_id), None)
        
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
                image_path = os.path.join(IMAGES_DIR, image_id)
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
        clusters = load_clusters()
        
        # Create a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_path = temp_file.name
        temp_file.close()
        
        # Create zip file on disk
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add all unique photos
            all_photos = set()
            for group in clusters:
                all_photos.update(group.get('image_ids', []))
            
            for image_id in all_photos:
                image_path = os.path.join(IMAGES_DIR, image_id)
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
        faces = get_faces_in_image(filename)
        clusters = load_clusters()
        
        # Match faces to groups
        face_groups = []
        for face in faces:
            # Find which group this face belongs to
            for group in clusters:
                if filename in group.get('image_ids', []):
                    face_groups.append({
                        'face_coords': face,
                        'group_id': group['id'],
                        'group_label': group.get('label', f'Person_{group["id"]}'),
                        'group_representative': group.get('representative_crop', group.get('representative'))
                    })
                    break
        
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
        clusters = load_clusters()
        faces = get_faces_in_image(filename)
        
        # Find which groups this photo belongs to
        photo_groups = []
        for group in clusters:
            if filename in group.get('image_ids', []):
                photo_groups.append({
                    'id': group['id'],
                    'label': group.get('label', f'Person_{group["id"]}'),
                    'representative': group.get('representative_crop', group.get('representative'))
                })
        
        return jsonify({
            'filename': filename,
            'faces_count': len(faces),
            'groups': photo_groups
        })
    except Exception as e:
        print(f"Error getting photo info for {filename}: {e}")
        return jsonify({"error": "Failed to get photo info"}), 500

# Serve images
@app.route('/images/<path:filename>')
def get_image(filename):
    return send_from_directory(IMAGES_DIR, filename)

# Serve face crops
@app.route('/crops/<path:filename>')
def get_crop(filename):
    return send_from_directory(CROPS_DIR, filename)

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)
