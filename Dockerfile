FROM golang:1.27.3-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/keybox ./cmd/keybox

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 keybox \
    && useradd --uid 10001 --gid keybox --no-create-home --shell /usr/sbin/nologin keybox
COPY --from=build /out/keybox /usr/local/bin/keybox
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["keybox"]
CMD ["serve"]
