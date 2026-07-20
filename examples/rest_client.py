#!/usr/bin/env python3
"""
Python client example for sudrf-mcp REST API.
Install: pip install requests
"""

import os
from typing import Optional, List, Dict, Any
import requests


class SudrfRestClient:
    """Python client for sudrf-mcp REST API."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        })

    def _request(self, method: str, endpoint: str, json: Optional[Dict[str, Any]] = None) -> Any:
        """Make HTTP request and return JSON response."""
        url = f"{self.base_url}/{endpoint}"
        
        if method == "GET":
            resp = self.session.get(url)
        elif method == "POST":
            resp = self.session.post(url, json=json)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        resp.raise_for_status()
        return resp.json()

    # ── Tools ────────────────────────────────────────────────────────────

    def list_case_categories(self) -> List[Dict[str, Any]]:
        """List all case categories (delo_id)."""
        return self._request("GET", "list_case_categories")

    def resolve_court(self, query: str) -> Dict[str, Any]:
        """Resolve court subdomain from name/region/vnkod."""
        return self._request("POST", "resolve_court", {"query": query})

    def get_hearing_schedule(self, court: str, date: str) -> Dict[str, Any]:
        """Get hearing schedule for a court on a date (DD.MM.YYYY)."""
        return self._request("POST", "get_hearing_schedule", {
            "court": court,
            "date": date
        })

    def search_cases(
        self,
        court: str,
        delo_id: int,
        case_number: Optional[str] = None,
        uid: Optional[str] = None,
        participant_name: Optional[str] = None,
        inn: Optional[str] = None,
        judge: Optional[str] = None,
        entry_date_from: Optional[str] = None,
        entry_date_to: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Extended case search with filters."""
        payload = {"court": court, "delo_id": delo_id}
        
        if case_number:
            payload["caseNumber"] = case_number
        if uid:
            payload["uid"] = uid
        if participant_name:
            payload["participantName"] = participant_name
        if inn:
            payload["inn"] = inn
        if judge:
            payload["judge"] = judge
        if entry_date_from:
            payload["entryDateFrom"] = entry_date_from
        if entry_date_to:
            payload["entryDateTo"] = entry_date_to
        
        payload.update(kwargs)
        return self._request("POST", "search_cases", payload)

    def get_case_details(
        self,
        court: str,
        case_url: str,
        include_document_text: bool = True
    ) -> Dict[str, Any]:
        """Get full case details with judicial acts."""
        return self._request("POST", "get_case_details", {
            "court": court,
            "caseUrl": case_url,
            "includeDocumentText": include_document_text
        })

    def index_case(
        self,
        court: str,
        case_url: str,
        replace: bool = False
    ) -> Dict[str, Any]:
        """Index a case's judicial acts into the RAG corpus."""
        return self._request("POST", "index_case", {
            "court": court,
            "caseUrl": case_url,
            "replace": replace
        })

    def search_case_texts(
        self,
        query: str,
        limit: int = 10,
        court: Optional[str] = None,
        case_number: Optional[str] = None
    ) -> Dict[str, Any]:
        """Full-text search in indexed judicial acts."""
        payload = {"query": query, "limit": limit}
        if court:
            payload["court"] = court
        if case_number:
            payload["caseNumber"] = case_number
        return self._request("POST", "search_case_texts", payload)

    def list_indexed_cases(self) -> Dict[str, Any]:
        """List all cases in the RAG corpus."""
        return self._request("GET", "list_indexed_cases")

    def remove_case(self, case_uid: str) -> Dict[str, Any]:
        """Remove a case from the RAG corpus."""
        return self._request("POST", "remove_case", {"caseUid": case_uid})


# ── Example usage ────────────────────────────────────────────────────────

def example():
    """Example workflow using the REST client."""
    token = os.getenv("TOKEN") or os.getenv("SUDRF_TOKEN")
    if not token:
        raise ValueError("TOKEN environment variable is required")

    client = SudrfRestClient("http://localhost:8080/rest", token)

    # 1. List categories
    categories = client.list_case_categories()
    print(f"Categories: {len(categories)}")
    civil_cat = next((c for c in categories if c["name"] == "CIVIL"), None)

    # 2. Resolve court
    court = client.resolve_court("Мордовия")
    print(f"Court: {court['subdomain']} - {court['name']}")

    # 3. Get today's hearing schedule
    from datetime import date
    today = date.today().strftime("%d.%m.%Y")
    schedule = client.get_hearing_schedule(court["subdomain"], today)
    print(f"Hearings on {today}: {schedule['count']}")

    # 4. Search civil cases
    if civil_cat:
        cases = client.search_cases(
            court=court["subdomain"],
            delo_id=civil_cat["id"],
            entry_date_from="01.01.2024",
            entry_date_to="31.12.2024"
        )
        print(f"Civil cases found: {cases['total']}")

        # 5. Get details for first case
        if cases["results"] and cases["results"][0].get("caseUrl"):
            case_url = cases["results"][0]["caseUrl"]
            details = client.get_case_details(
                court=court["subdomain"],
                case_url=case_url,
                include_document_text=False  # metadata only
            )
            print(f"Case {details['caseNumber']}:")
            print(f"  Category: {details['category']}")
            print(f"  Events: {len(details['events'])}")
            print(f"  Documents: {len(details['documents'])}")

            # 6. Index the case
            indexed = client.index_case(
                court=court["subdomain"],
                case_url=case_url
            )
            print(f"Indexed: {indexed['chunksAdded']} chunks added")

    # 7. Search case texts
    corpus = client.list_indexed_cases()
    print(f"Corpus: {corpus['corpusSize']} chunks, {corpus['caseCount']} cases")

    if corpus["caseCount"] > 0:
        text_search = client.search_case_texts(
            query="срок исковой давности",
            limit=5
        )
        print(f"Text search: {text_search['total']} hits")
        
        if text_search["hits"]:
            hit = text_search["hits"][0]
            print(f"  Top hit (score {hit['score']}):")
            print(f"    {hit['caseNumber']} - {hit['court']}")
            print(f"    {hit['actType']} ({hit['actDate']})")
            print(f"    Text preview: {hit['text'][:150]}...")


if __name__ == "__main__":
    try:
        example()
    except Exception as e:
        print(f"Error: {e}")
        exit(1)
