import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconX } from "@tabler/icons-react";
import { Button } from "@heroui/react";

type NewsItem = {
  id: string;
  title: string;
  content: string;
  image: string;
  createdAt: string;
  published: boolean;
};

function NewsModal({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  const date = new Date(item.createdAt).toLocaleDateString("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed z-9999 top-0 left-0 w-screen h-screen bg-black/50 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="tertiary"
          size="sm"
          isIconOnly
          className="absolute z-20 top-3 right-3"
          onPress={onClose}
        >
          <IconX size={16} />
        </Button>
        <div
          className="bg-background border border-border/30 rounded-3xl"
          style={{
            width: "min(680px, 90vw)",
            height: "80vh",
            overflowY: "auto",
          }}
        >
          <div
            className="relative z-10 overflow-hidden"
            style={{
              width: "100%",
              height: "60%",
            }}
          >
            <img
              src={item.image}
              alt={item.title}
              className="absolute -z-10 blur-3xl opacity-30"
              style={{
                width: "300%",
                height: "300%",
                objectFit: "cover",
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <img
              src={item.image}
              alt={item.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          <div
            className="bg-surface"
            style={{
              padding: "20px 24px",
            }}
          >
            <h2
              style={{
                margin: "0 0 3px",
                fontSize: 20,
                fontWeight: 700,
                color: "#fff",
                lineHeight: 1.3,
              }}
            >
              {item.title}
            </h2>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 11,
                color: "var(--accent)",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {date}
            </p>
            <p
              className="text-muted"
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                userSelect: "text",
              }}
            >
              {item.content}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewsCarousel() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NewsItem | null>(null);

  useEffect(() => {
    invoke<NewsItem[]>("get_news")
      .then((data) => {
        setNews(data.filter((n) => n.published && n.image && n.image.trim() !== ""));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 200,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            border: "2px solid #ffffff11",
            borderTop: "2px solid #4ade80",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!news.length) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 200,
          color: "#444",
          fontSize: 13,
        }}
      >
        No news available
      </div>
    );
  }

  return (
    <>
      {selected && (
        <NewsModal item={selected} onClose={() => setSelected(null)} />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
          padding: "4px 2px",
        }}
      >
        {news.map((item) => (
          <NewsCard
            key={item.id}
            item={item}
            onClick={() => setSelected(item)}
          />
        ))}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .news-card { transition: transform 0.15s ease, border-color 0.15s ease; }
        .news-card:hover { transform: translateY(-2px); }
        .news-card:hover .news-title { color: #fff !important; }
      `}</style>
    </>
  );
}

function NewsCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const date = new Date(item.createdAt).toLocaleDateString("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="news-card border border-border/30 hover:border-accent/50 bg-surface rounded-3xl"
      onClick={onClick}
      style={{
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "16/9",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <img
          src={item.image}
          alt={item.title}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            display: "flex",
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              padding: "2px 7px",
              borderRadius: 3,
              letterSpacing: "0.03em",
            }}
          >
            News
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "10px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
        }}
      >
        <h3
          className="news-title"
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: "#ddd",
            lineHeight: 1.35,
            transition: "color 0.15s",
          }}
        >
          {item.title}
        </h3>

        {item.content && (
          <p
            className="text-muted"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.content}
          </p>
        )}

        <span
          className="text-surface-foreground/70"
          style={{
            marginTop: "auto",
            paddingTop: 8,
            fontSize: 10,
          }}
        >
          {date}
        </span>
      </div>
    </div>
  );
}
