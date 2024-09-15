import logging
import sys
# 
import zipfile
import pandas as pd
import requests
from bs4 import BeautifulSoup
import random
import re
from scholarly import scholarly, ProxyGenerator
import time
FILE_NAME = 'random_sample_200k.csv'
BATCH_SIZE = 10

def is_valid_title(title):
    # This regex allows only alphanumeric characters, spaces, hyphens, and colons
    return bool(re.match(r'^[a-zA-Z0-9\s\-:]+$', title))

def get_random_user_agent():
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
    ]
    return random.choice(user_agents)

def setup_proxy():
    pg = ProxyGenerator()
    success = pg.FreeProxies()
    if success:
        scholarly.use_proxy(pg)
        print("Successfully set up proxy")
        return True
    else:
        print("Failed to set up proxy. Continuing without proxy.")
        return False
    
def get_first_valid_title(df):
    # csv file
    # csv file
    for title in df['title']:
        if is_valid_title(title):
            return title
    return None  # Return None if no valid title is found

def search_paper_citations(title):
    print(f"Searching for: {title}")
    try:
        search_query = scholarly.search_pubs(title)
        paper = next(search_query)
        citations = paper['num_citations']
        print(f"Paper details:")
        scholarly.pprint(paper)
        return citations
    except StopIteration:
        print(f"No results found for '{title}'")
        return None
    except Exception as e:
        print(f"Error searching for paper '{title}': {str(e)}")
        return None

def get_first_valid_author(df):
    for author in df['submitter']:
        return author
    return None  # Return None if no valid author is found
def get_citations(title):
    
    if title:
        print(f"First valid paper title: {title}")
        
        citations = search_paper_citations(title)
        
        if citations is not None:
            print(f"Citations for '{title[:50]}...': {citations}")
        else:
            print(f"Failed to retrieve citations for '{title[:50]}...'")
    else:
        print("No valid titles found in the dataset.")

def main():
    proxy_success = setup_proxy()
    
    df = pd.read_csv(FILE_NAME)
    df['cited_by'] = None
    
    for index, row in df.iterrows():
        title = row['title']
        if is_valid_title(title):
            citations = search_paper_citations(title)
            df.at[index, 'cited_by'] = citations
            
            # Change headers randomly to avoid being blocked
            # scholarly.set_headers({'User-Agent': get_random_user_agent()})

            # Add a delay to avoid overwhelming the server
            time.sleep(random.uniform(2, 5))
    
    # Save the updated DataFrame
    df.to_csv('updated_citations.csv', index=False)
    print("Updated data saved to 'updated_citations.csv'")

if __name__ == '__main__':
    main()



