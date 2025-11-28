"""
Distribution logic for Mock Rekognition.

This module handles the statistical distribution of faces and people
to generate realistic clustering scenarios.
"""

import random
import uuid
from typing import List, Optional

class DistributionManager:
    """
    Manages the distribution of faces and people for realistic simulation.
    
    Features:
    - Maintains a population of "virtual people"
    - Assigns people to images based on probability distributions
    - Handles "same person in multiple images" logic
    - Handles "multiple people in one image" logic
    - Supports the edge case of "same person twice in one image" (0.1% chance)
    """
    
    def __init__(self, population_size: int = 100):
        """
        Initialize the distribution manager.
        
        Args:
            population_size: Number of unique people in the virtual population.
        """
        self.population_size = population_size
        # Generate stable population IDs based on seed or deterministic pattern
        # to ensure consistency if needed, but random UUIDs are fine for now
        # as long as we reuse them.
        self.population = [str(uuid.uuid4()) for _ in range(population_size)]
        
    def set_population(self, population: List[str]):
        """Set an existing population (e.g. from loaded data)."""
        self.population = population
        self.population_size = len(population)
        
    def get_population(self) -> List[str]:
        """Get the current population."""
        return self.population
        
    def ensure_population_size(self, size: int):
        """Ensure population has at least `size` people."""
        if len(self.population) < size:
            needed = size - len(self.population)
            self.population.extend([str(uuid.uuid4()) for _ in range(needed)])
            self.population_size = len(self.population)

    def select_people_for_image(self, num_faces: int) -> List[str]:
        """
        Select people to appear in an image.
        
        Args:
            num_faces: Number of faces to generate for the image.
            
        Returns:
            List of person_ids.
        """
        if num_faces <= 0:
            return []
            
        # Ensure we have enough people in the population
        # If we need more people than population (unlikely for reasonable defaults), expand
        if num_faces > self.population_size:
            self.ensure_population_size(num_faces + 50)
            
        # 0.1% chance to have the same person twice in the image
        allow_duplicates = random.random() < 0.001
        
        selected_people = []
        
        if allow_duplicates and num_faces >= 2:
            # Pick one person to appear twice
            duplicate_person = random.choice(self.population)
            selected_people.append(duplicate_person)
            selected_people.append(duplicate_person)
            
            # Fill the rest
            remaining = num_faces - 2
            if remaining > 0:
                # Can pick anyone for the rest, avoiding strict uniqueness if we want messy real world data
                # But typically distinct people for the rest
                candidates = [p for p in self.population if p != duplicate_person]
                selected_people.extend(random.sample(candidates, remaining))
        else:
            # Standard case: distinct people
            selected_people = random.sample(self.population, num_faces)
            
        return selected_people

    def determine_face_count(self) -> int:
        """
        Determine number of faces for an image based on distribution.
        
        Distribution (approximate based on requirements):
        - 1 face: 30%
        - 2 faces: 25%
        - 3 faces: 20%
        - 4 faces: 15%
        - 5+ faces: 10%
        """
        rand = random.random()
        if rand < 0.30: return 1
        elif rand < 0.55: return 2
        elif rand < 0.75: return 3
        elif rand < 0.90: return 4
        else: return random.randint(5, 10)

