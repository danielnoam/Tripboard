### Fixed
- An AI's publish_trip and unpublish_trip now act on the server a trip was published on. For a trip you published on your own sharing server, unpublish used to say it had stopped while the trip stayed public there and its key was dropped, so nothing could stop it afterwards; publish made a second copy on Tripboard's server.
- A trip published through the cloud connector on your own server gets a link that names that server, so the link opens.
