# Use a Python base image
FROM python:3.11-alpine

# Set the working directory in the container
WORKDIR /app

# Copy your project files into the container
COPY code /app

# Copy the entrypoint script into the container
COPY entrypoint.sh /app/entrypoint.sh

# Set execute permissions for the entrypoint script
RUN chmod +x /app/entrypoint.sh

# Expose the port your app runs on
EXPOSE 3000

# Define the entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
