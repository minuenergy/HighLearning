import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.config import settings
from app.services.document_parsing_service import extract_pdf_text, extract_pptx_text

chroma_client = chromadb.PersistentClient(path="./chroma_db")
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)


def extract_text_from_pdf(file_bytes: bytes) -> str:
    text, _parser_used = extract_pdf_text(file_bytes)
    return text


def extract_text_from_pptx(file_bytes: bytes) -> str:
    text, _parser_used = extract_pptx_text(file_bytes)
    return text


def index_material(course_id: str, material_id: str, text: str):
    return index_material_pages(course_id, material_id, [{"page_number": 1, "text": text}])


def index_material_pages(course_id: str, material_id: str, pages: list[dict]):
    collection = chroma_client.get_or_create_collection(f"course_{course_id}")
    batch_documents: list[str] = []
    batch_ids: list[str] = []
    batch_metadatas: list[dict] = []
    total_chunks = 0

    def flush_batch() -> None:
        nonlocal total_chunks
        if not batch_documents:
            return
        collection.add(
            documents=batch_documents.copy(),
            ids=batch_ids.copy(),
            metadatas=batch_metadatas.copy(),
        )
        total_chunks += len(batch_documents)
        batch_documents.clear()
        batch_ids.clear()
        batch_metadatas.clear()

    batch_size = max(1, settings.rag_add_batch_size)

    for page in pages:
        page_number = int(page.get("page_number") or 0)
        page_text = str(page.get("text") or "").strip()
        if not page_text:
            continue
        page_chunks = splitter.split_text(page_text)
        for chunk_index, chunk in enumerate(page_chunks):
            batch_documents.append(chunk)
            batch_ids.append(f"{material_id}_{page_number}_{chunk_index}")
            batch_metadatas.append(
                {
                    "material_id": material_id,
                    "course_id": course_id,
                    "page_number": page_number,
                }
            )
            if len(batch_documents) >= batch_size:
                flush_batch()

    flush_batch()
    return total_chunks


def retrieve_context(course_id: str, query: str, n_results: int = 5) -> str:
    collection = chroma_client.get_or_create_collection(f"course_{course_id}")
    results = collection.query(query_texts=[query], n_results=n_results)
    docs = results.get("documents", [[]])[0]
    return "\n\n".join(docs)
