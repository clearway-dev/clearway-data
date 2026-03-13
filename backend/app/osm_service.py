from sqlalchemy.orm import Session
import osmnx as ox
from app.models import RoadSegment
from geoalchemy2.shape import from_shape

class OSMService:
    def __init__(self, db: Session):
        self.db = db

    def import_segments_for_place(self, place_name: str = "Plzeň, Czechia"):
        print(f"Importing road segments for place: {place_name}")

        G = ox.graph_from_place(place_name, network_type='drive')

        gdf_nodes, gdf_edges = ox.graph_to_gdfs(G)

        print(f"Number of edges fetched: {len(gdf_edges)}")

        gdf_edges = gdf_edges.reset_index()

        count = 0
        for _, row in gdf_edges.iterrows():
            name = row.get('name')
            if isinstance(name, list):
                name = name[0] 

            road_type = row.get('highway')
            if isinstance(road_type, list):
                road_type = road_type[0]

            osm_id_str = f"{row['u']}-{row['v']}-{row['key']}"

            segment = RoadSegment(
                osm_id=osm_id_str,
                name=str(name) if name else "Unknown",
                road_type=str(road_type),
                geom=from_shape(row['geometry'], srid=4326)
            )

            self.db.merge(segment)
            count += 1
        
            if count % 1000 == 0:
                self.db.commit()
                print(f"Committed {count} segments so far.")
    
        self.db.commit()
        print(f"Finished importing. Total segments imported: {count}")