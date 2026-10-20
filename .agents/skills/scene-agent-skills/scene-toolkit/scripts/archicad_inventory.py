"""Read-only inventory through the official Archicad Python connection.

Install Graphisoft's archicad package in a separate suitable Python environment.
Start Archicad and open the imported project before running this file.
"""
import json


def inventory():
    from archicad import ACConnection
    conn=ACConnection.connect()
    if conn is None:
        raise RuntimeError('No Archicad connection found. Start a supported host and open a project.')
    counts={}
    for kind in ('Wall','Slab','Door','Window','Morph','Object'):
        counts[kind]=len(conn.commands.GetElementsByType(kind))
    return {'read_only':True,'counts':counts,
            'note':'Counts alone do not prove native editability, dimensions or correct translator mapping.'}


if __name__=='__main__':
    print(json.dumps(inventory(),indent=2))
