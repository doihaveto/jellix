# Jellix
![Jellix](https://i.imgur.com/vHJc5xO.png)

A web-based Jellyfin client that delivers user-friendly, daily watching recommendations.

Features:
- Filters by:
  - Production year
  - Community rating (IMDB)
  - Critic rating (Rotten Tomatoes)
  - Maximum runtime
  - Hide played movies
- Categories:
  - Today's picks (random movies, consistent across the day).
  - Latest movies
  - Newest movies
  - Favourites
  - Each available genre
- Plays movie trailers automatically (can be disabled in the settings menu).

![Screenshot](https://i.imgur.com/wwueVA6.png)

## Installation
You can either use docker, or manually run it.

### Docker
An `API_URL` environment variable is required with the value being the address to your Jellyfin server, including trailing slash (`http://localhost:5000/`, for example).
An example docker-compose file:
```
services:
  jellix:
    image: ghcr.io/doihaveto/jellix
    container_name: jellix
    restart: unless-stopped 
    environment:
      - API_URL=http://localhost:5000/
    ports:
      - 3000:80
```

This will run Jellix on port 3000.

### Manual
This project is composed entirely of static files. All that it requires is a web server. First, edit `code/params.js` to your Jellyfin server, including trailing slash (`http://localhost:5000/`, for example). After that you can either deliver this project as a static directory via nginx or some other web server, or you can spin one your own with python by running `python -m http.server 3000` in the `code` directory, which you can then access via http://localhost:3000/
