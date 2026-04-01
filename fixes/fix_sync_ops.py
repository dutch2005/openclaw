import re
import os

path = 'src/memory/manager-sync-ops.ts'
if os.path.exists(path):
    with open(path, 'r') as f:
        content = f.read()

    # Match the specific block
    # Note: Using a more generic match to be safe against indentation changes
    pattern = r'this\.db\s+\.prepare\(\s+`INSERT INTO meta \(key, value\) VALUES \(\?, \?\) ON CONFLICT\(key\) DO UPDATE SET value=excluded\.value`,\s+\)\s+\.run\(META_KEY, value\);'
    
    # Check if already fixed
    if 'await this.db' not in content:
        # Simple replacement of the start of the block
        fixed = content.replace('this.db\n        .prepare(\n          `INSERT INTO meta', 'await this.db\n        .prepare(\n          `INSERT INTO meta')
        
        with open(path, 'w') as f:
            f.write(fixed)
        print("Fixed.")
    else:
        print("Already fixed.")
else:
    print("File not found.")
